import * as Y from 'yjs';
import { classify, extractTodos } from './classifier.js';
import { persistYjsUpdate } from './event-log.js';
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
  
  let todos: string[] = [];
  if (intent === 'action_item') {
    todos = await extractTodos(text);
  } else if (intent === 'open_question') {
    todos = [text.trim()];
  }

  const doc = nodeMap.doc;
  if (!doc) return;

  // Write intent into the Y.Doc and capture the resulting update binary
  let encodedUpdate: Uint8Array | null = null;
  const captureUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === SERVER_INTENT_ORIGIN) encodedUpdate = update;
  };
  doc.on('update', captureUpdate);

  doc.transact(() => {
    nodeMap.set('intent', intent);
    
    if (intent === 'action_item' || intent === 'open_question') {
      // Create todo objects
      const todoObjects = todos.map((t, i) => ({
        id: `${nodeId}-todo-${Date.now()}-${i}`,
        text: t,
        kind: intent,
        status: 'open',
      }));
      nodeMap.set('todos', todoObjects);
    } else {
      nodeMap.delete('todos');
    }
  }, SERVER_INTENT_ORIGIN);


  doc.off('update', captureUpdate);

  // Persist the intent update to the event log so it survives server restarts
  if (encodedUpdate) {
    persistYjsUpdate(roomId, '__server__', encodedUpdate);
  }

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
 * Uses `event.path` to identify which node and field changed.
 *
 * Server-originated intent updates are broadcast to all clients AND persisted
 * to the event log so they survive server restarts (replayed during hydration).
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
      if (path.length === 0) continue;

      const nodeId = path[0] as string;

      if (path.length === 1) {
        const mapEvent = event as Y.YMapEvent<unknown>;
        const keys = mapEvent.changes?.keys;
        if (!keys) continue;
        // Skip if only intent changed (we wrote it, avoid loop)
        if (keys.size === 1 && keys.has('intent')) continue;
        if (keys.has('content')) toClassify.add(nodeId);
      } else if (path.length >= 2 && path[1] === 'content') {
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

  // On cold start: re-classify any nodes that have content but no intent yet.
  // This covers nodes whose intent was never persisted (e.g. pre-event-log era).
  // Results are persisted to the event log so future restarts load them from there.
  let startupDelay = 0;
  for (const [nodeId, nodeMap] of nodes) {
    if (!(nodeMap instanceof Y.Map)) continue;
    if (nodeMap.get('intent')) continue; // already classified
    const text = getTextContent(nodeMap);
    if (!text.trim()) continue;
    setTimeout(() => {
      void applyIntent(roomId, nodeId, nodeMap, text);
    }, startupDelay);
    startupDelay += 150; // stagger to stay within Groq rate limits
  }

  console.log(`[intent-watcher] watching room=${roomId}`);
}
