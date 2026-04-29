import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { getRoomOrCreate } from '../rooms.js';
import { hydrateDocFromDB } from '../ydoc-store.js';
import { buildPdf } from '../export-pdf.js';

interface ExportBody {
  mode: 'narrative' | 'structured';
  image: string | null; // raw base64 PNG (no data-URL prefix)
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const NARRATIVE_SYSTEM = `You are a meeting note-taker. Write a concise prose summary (3–5 paragraphs) of a collaborative whiteboard session for someone who wasn't there. Cover what was decided, what needs to happen next, and what is still unresolved. Attribute items to people by name. Be specific and direct. Use plain text only — no markdown, no asterisks, no headers, no bullet points.`;

const STRUCTURED_SYSTEM = `You are organizing collaborative whiteboard notes into a structured brief.

Rules:
- Output ONLY the sections below that have at least one item. Omit empty sections entirely.
- Each section header must appear ALONE on its own line, exactly as written below.
- Each item goes on its own separate line, directly below the header. Never put an item on the same line as a header.
- Format each item as: Author Name: item text.
- Use plain text only. No markdown, no asterisks, no dashes, no bullet symbols, no numbered lists, no colons after headers.

Intent mapping: notes tagged [decision] → Decisions, [action] → Action Items, [question] or [blocker] → Open Questions, [reference] → References, [none] → whichever section fits best.

Output format (use exactly this structure):
Decisions
Author Name: decision text here.

Action Items
Author Name: action item text here.

Open Questions
Author Name: open question or blocker text here.

References
Author Name: reference text here.`;

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: ExportBody }>(
    '/rooms/:id/export',
    {
      preHandler: requireAuth,
      bodyLimit: 12 * 1024 * 1024, // 12MB to accommodate large canvas screenshots
    },
    async (request, reply) => {
      const roomId = request.params.id;
      const user = request.user!;
      const { mode, image } = request.body;

      // ── 1. Membership check ──────────────────────────────────────────
      const membershipRes = await query<{ role: string }>(
        `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
        [roomId, user.id]
      );
      if (!membershipRes.rows[0]) {
        return reply.code(403).send({ error: 'Not a member of this room' });
      }

      // ── 2. Ensure Y.Doc is hydrated ──────────────────────────────────
      await hydrateDocFromDB(roomId);
      const room = getRoomOrCreate(roomId);
      console.log(`[export] hydrated=${(room.doc as any)._hydrated} clients=${room.clients.size}`);

      // ── 3. Fetch room name ────────────────────────────────────────────
      const roomRes = await query<{ name: string }>(
        `SELECT name FROM rooms WHERE id = $1`,
        [roomId]
      );
      const roomName = roomRes.rows[0]?.name ?? 'Untitled';

      // ── 4. Fetch members ──────────────────────────────────────────────
      const membersRes = await query<{ id: string; name: string; role: string }>(
        `SELECT u.id, u.name, m.role
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         WHERE m.room_id = $1`,
        [roomId]
      );
      const memberMap = new Map(membersRes.rows.map((m) => [m.id, m]));
      const members = membersRes.rows.map((m) => ({ name: m.name, role: m.role }));

      // ── 5. Extract text nodes from Y.Doc ─────────────────────────────
      const nodesYMap = room.doc.getMap<Y.Map<unknown>>('nodes');
      const textNodes: Array<{ content: string; intent: string; author: string }> = [];

      console.log(`[export] nodesYMap.size=${nodesYMap.size} room=${roomId}`);
      for (const [key, nodeMap] of nodesYMap) {
        if (!(nodeMap instanceof Y.Map)) {
          console.log(`[export] node ${key} is not a Y.Map, skipping`);
          continue;
        }
        const type = nodeMap.get('type') as string;
        const contentRaw2 = nodeMap.get('content');
        const contentStr = contentRaw2 instanceof Y.Text ? contentRaw2.toString() : String(contentRaw2 ?? '');
        console.log(`[export] node ${key} type=${type} contentLen=${contentStr.length}`);
        if (type !== 'sticky' && type !== 'text') continue;

        const contentRaw = nodeMap.get('content');
        const content =
          contentRaw instanceof Y.Text
            ? contentRaw.toString().trim()
            : typeof contentRaw === 'string'
              ? (contentRaw as string).trim()
              : '';
        if (!content) continue;

        const intent = (nodeMap.get('intent') as string | undefined) ?? 'none';
        const authorId = nodeMap.get('author_id') as string | undefined;
        const author = (authorId ? memberMap.get(authorId)?.name : undefined) ?? 'Unknown';

        textNodes.push({ content, intent, author });
      }

      // ── 6. Call Groq ──────────────────────────────────────────────────
      let aiText = 'No text content found on this canvas.';

      if (textNodes.length > 0) {
        const apiKey = process.env['GROQ_API_KEY'];
        if (!apiKey) {
          return reply.code(500).send({ error: 'AI unavailable — GROQ_API_KEY not set' });
        }

        const exportDate = new Date().toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
        const membersLine = members.map((m) => `${m.name} (${m.role})`).join(', ');
        const nodeLines = textNodes
          .map((n) => `- [${n.intent}] "${n.content}" — ${n.author}`)
          .join('\n');
        const userContent = `Date: ${exportDate}\nRoom: "${roomName}"\nMembers: ${membersLine}\nSticky notes:\n${nodeLines}`;

        const groqRes = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: mode === 'narrative' ? NARRATIVE_SYSTEM : STRUCTURED_SYSTEM },
              { role: 'user', content: userContent },
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
        });

        if (!groqRes.ok) {
          const errText = await groqRes.text();
          console.error('[export] Groq error:', errText);
          return reply.code(500).send({ error: 'AI request failed' });
        }

        const groqJson = (await groqRes.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        aiText = groqJson.choices[0]?.message.content.trim() ?? aiText;
      }

      // ── 7. Build PDF ──────────────────────────────────────────────────
      const imageBuffer = image ? Buffer.from(image, 'base64') : null;
      const exportDate = new Date().toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });

      const pdfBuffer = await buildPdf({
        roomName,
        members,
        aiText,
        mode,
        imageBuffer,
        exportDate,
      });

      const date = new Date().toISOString().slice(0, 10);
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="${roomName.replace(/[^a-z0-9]/gi, '_')}_Summary.pdf"`
        )
        .send(pdfBuffer);
    }
  );
}
