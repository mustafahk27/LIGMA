import * as Y from 'yjs';
import { classify } from './classifier.js';
import { query } from './db.js';
import { broadcastToRoom } from './rooms.js';

const SERVER_INTENT_ORIGIN = 'server-intent';

// ─── Per-node debounce timers ─────────────────────────────────────────────────
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(roomId: string, nodeId: string): string {
  return `${roomId}:${nodeId}`;
}

// ─── Intent application ───────────────────────────────────────────────────────

async function applyIntent(
  roomId: string,
  nodeId: string,
  nodeMap: Y.Map<unknown>,
  text: string
): Promise<void> {
  const intent = await classify(text);

  const doc = nodeMap.doc;
  if (doc) {
    doc.transact(() => {
      nodeMap.set('intent', intent);
    }, SERVER_INTENT_ORIGIN);
  } else {
    nodeMap.set('intent', intent);
  }

  await query(
    `UPDATE canvas_nodes SET intent = $1, updated_at = NOW()
     WHERE id = $2 AND room_id = $3`,
    [intent, nodeId, roomId]
  ).catch((err: unknown) => {
    console.error(`[intent-watcher] DB write failed node=${nodeId}:`, err);
  });

  console.log(
    `[intent-watcher] room=${roomId} node=${nodeId} intent=${intent} ` +
      `text="${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`
  );
}

// ─── Debounce helper ──────────────────────────────────────────────────────────

function scheduleClassify(
  roomId: string,
  nodeId: string,
  nodeMap: Y.Map<unknown>,
  getText: () => string
): void {
  const key = timerKey(roomId, nodeId);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    timers.delete(key);
    const text = getText();
    if (!text.trim()) return;
    void applyIntent(roomId, nodeId, nodeMap, text);
  }, 800);

  timers.set(key, timer);
}

// ─── Text content helper ──────────────────────────────────────────────────────

function getTextContent(nodeMap: Y.Map<unknown>): string {
  const content = nodeMap.get('content');
  if (content instanceof Y.Text) return content.toString();
  if (typeof content === 'string') return content;
  return '';
}

// ─── Room-level watcher ───────────────────────────────────────────────────────

/**
 * Attach a single deep observer to the room's top-level `nodes` Y.Map.
 * Uses `event.path` to identify which node and field changed, which is more
 * reliable than per-node observers (avoids Y.Map instance identity issues).
 *
 * Also listens for doc updates tagged SERVER_INTENT_ORIGIN and broadcasts
 * them to all connected WebSocket clients.
 */
export function watchRoomDoc(roomId: string, doc: Y.Doc): void {
  // Broadcast server-originated intent updates to all clients
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === SERVER_INTENT_ORIGIN) {
      broadcastToRoom(roomId, '__server__', update);
    }
  });

  const nodes = doc.getMap<Y.Map<unknown>>('nodes');

  nodes.observeDeep((events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const toClassify = new Set<string>();

    for (const event of events) {
      const path = event.path;
      if (path.length === 0) continue; // change to nodes map itself (add/remove)

      const nodeId = path[0] as string;

      if (path.length === 1) {
        // A key inside a nodeMap changed (e.g. 'content' replaced, or 'intent' written)
        const mapEvent = event as Y.YMapEvent<unknown>;
        const keys = mapEvent.changes?.keys;
        if (!keys) continue;
        // Skip if only intent changed (we wrote it, avoid loop)
        if (keys.size === 1 && keys.has('intent')) continue;
        if (keys.has('content')) toClassify.add(nodeId);
      } else if (path.length >= 2 && path[1] === 'content') {
        // Character-level edit inside the Y.Text content field
        toClassify.add(nodeId);
      }
    }

    for (const nodeId of toClassify) {
      const nodeMap = nodes.get(nodeId);
      if (nodeMap instanceof Y.Map) {
        scheduleClassify(roomId, nodeId, nodeMap, () => getTextContent(nodeMap));
      }
    }
  });

  console.log(`[intent-watcher] watching room=${roomId}`);
}
