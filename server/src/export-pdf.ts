import PDFDocument from 'pdfkit';

export interface ExportMember {
  name: string;
  role: string;
}

export interface ExportOptions {
  roomName: string;
  members: ExportMember[];
  aiText: string;
  mode: 'narrative' | 'structured';
  imageBuffer: Buffer | null;
  exportDate: string; // e.g. "29 Apr 2026"
}

// ─── Markdown stripper ────────────────────────────────────────────────────────

/**
 * Removes common markdown syntax from AI-generated text so it renders
 * cleanly in pdfkit (which has no markdown support).
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')   // ***bold italic***
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold**
    .replace(/\*(.*?)\*/g, '$1')            // *italic*
    .replace(/__(.*?)__/g, '$1')            // __underline__
    .replace(/^#{1,6}\s+/gm, '')            // ## headers
    .replace(/`{1,3}(.*?)`{1,3}/gs, '$1')  // `code`
    .replace(/^\s*[-*+]\s+/gm, '• ')       // - bullets → •
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')    // [link](url) → link
    .trim();
}

// ─── Structured section parser ────────────────────────────────────────────────

interface Section {
  header: string;
  items: string[];
}

const SECTION_HEADERS = ['Decisions', 'Action Items', 'Open Questions', 'References'];

function parseStructured(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of text.split('\n')) {
    const line = stripMarkdown(raw).trim();
    if (!line) continue;

    // Match header: exact, with colon, or "Header: inline item text"
    let matchedHeader: string | null = null;
    let inlineItem = '';

    for (const h of SECTION_HEADERS) {
      const lh = h.toLowerCase();
      const ll = line.toLowerCase();
      if (ll === lh || ll === lh + ':') {
        matchedHeader = h;
        break;
      }
      if (ll.startsWith(lh + ':')) {
        matchedHeader = h;
        inlineItem = line.slice(h.length + 1).trim();
        break;
      }
    }

    if (matchedHeader) {
      current = { header: matchedHeader, items: [] };
      sections.push(current);
      if (inlineItem) current.items.push(inlineItem);
    } else if (current) {
      // Strip bullets, dashes, numbered prefixes (1., 2., etc.)
      const item = line.replace(/^(?:[•\-*]|\d+\.)\s*/, '').trim();
      if (item) current.items.push(item);
    }
  }

  return sections.filter((s) => s.items.length > 0);
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

const ACCENT = '#4575f3';
const TEXT_PRIMARY = '#111111';
const TEXT_SECONDARY = '#555555';
const RULE_COLOR = '#e0e0e0';
const MARGIN = 50;

export async function buildPdf(opts: ExportOptions): Promise<Buffer> {
  const { roomName, members, aiText, mode, imageBuffer, exportDate } = opts;

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true });
  const chunks: Buffer[] = [];
  const pageW = doc.page.width;
  const contentW = pageW - MARGIN * 2;

  await new Promise<void>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', resolve);
    doc.on('error', reject);

    // ── Page 1: Cover ──────────────────────────────────────────────────

    // Accent bar at top
    doc.rect(0, 0, pageW, 6).fill(ACCENT);

    doc.moveDown(1.2);

    // Room name
    doc
      .fontSize(26)
      .font('Helvetica-Bold')
      .fillColor(TEXT_PRIMARY)
      .text(roomName, MARGIN, doc.y, { width: contentW });

    doc.moveDown(0.3);

    // Subtitle: "Session Brief"
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor(ACCENT)
      .text('Session Brief', { characterSpacing: 1 });

    doc.moveDown(0.6);

    // Date + members row
    const membersStr = `   ·   ${members.map((m) => `${m.name} (${m.role})`).join('  ·  ')}`;
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(TEXT_SECONDARY)
      .text(`${exportDate}${membersStr}`);

    doc.moveDown(0.8);

    // Thin rule
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(pageW - MARGIN, doc.y)
      .strokeColor(RULE_COLOR)
      .lineWidth(0.75)
      .stroke();

    doc.moveDown(1);

    // ── Canvas image ───────────────────────────────────────────────────
    if (imageBuffer) {
      const maxH = (doc.page.height - MARGIN * 2) * 0.52;
      doc.image(imageBuffer, MARGIN, doc.y, {
        fit: [contentW, maxH],
        align: 'center',
      });
    }

    // ── Page 2: AI summary ─────────────────────────────────────────────
    doc.addPage();

    // Accent bar
    doc.rect(0, 0, pageW, 6).fill(ACCENT);
    doc.moveDown(1.2);

    if (mode === 'narrative') {
      // Section title
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor(TEXT_PRIMARY)
        .text('Session Summary', MARGIN, doc.y);

      doc.moveDown(0.5);

      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(pageW - MARGIN, doc.y)
        .strokeColor(RULE_COLOR)
        .lineWidth(0.5)
        .stroke();

      doc.moveDown(0.8);

      // Clean AI text — strip any residual markdown
      const clean = stripMarkdown(aiText);

      // Split into paragraphs and render each
      for (const para of clean.split(/\n{2,}/)) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        doc
          .fontSize(10.5)
          .font('Helvetica')
          .fillColor(TEXT_PRIMARY)
          .text(trimmed, MARGIN, doc.y, {
            width: contentW,
            align: 'justify',
            lineGap: 3,
          });
        doc.moveDown(0.8);
      }
    } else {
      // Structured sections
      const sections = parseStructured(aiText);

      if (sections.length === 0) {
        // Fallback: render raw stripped text
        doc
          .fontSize(10.5)
          .font('Helvetica')
          .fillColor(TEXT_PRIMARY)
          .text(stripMarkdown(aiText), MARGIN, doc.y, { width: contentW, lineGap: 3 });
      } else {
        for (const section of sections) {
          // Section header
          doc
            .fontSize(13)
            .font('Helvetica-Bold')
            .fillColor(TEXT_PRIMARY)
            .text(section.header, MARGIN, doc.y);

          doc.moveDown(0.2);

          doc
            .moveTo(MARGIN, doc.y)
            .lineTo(pageW - MARGIN, doc.y)
            .strokeColor(RULE_COLOR)
            .lineWidth(0.5)
            .stroke();

          doc.moveDown(0.5);

          // Items
          for (const item of section.items) {
            const bulletX = MARGIN + 10;
            const textX = MARGIN + 22;
            const y = doc.y;

            doc
              .fontSize(9)
              .font('Helvetica-Bold')
              .fillColor(ACCENT)
              .text('•', MARGIN, y, { width: 20, continued: false });

            doc
              .fontSize(10)
              .font('Helvetica')
              .fillColor(TEXT_PRIMARY)
              .text(item, textX, y, { width: contentW - 22, lineGap: 2 });

            doc.moveDown(0.4);
          }

          doc.moveDown(0.8);
        }
      }
    }

    // ── Page number footer ─────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Zero the bottom margin so pdfkit doesn't auto-create a new page
      // when we write text in the footer area (below the content zone).
      const origBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(TEXT_SECONDARY)
        .text(
          `${i + 1} / ${range.count}`,
          MARGIN,
          doc.page.height - 35,
          { width: contentW, align: 'right' }
        );
      doc.page.margins.bottom = origBottom;
    }

    doc.end();
  });

  return Buffer.concat(chunks);
}
