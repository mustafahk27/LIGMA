import * as Y from 'yjs';
import { getRoomOrCreate, broadcastToRoom } from './rooms.js';
import { getEventsSince, persistYjsUpdate, appendEvent } from './event-log.js';
import { validateUpdate, type Role, type ValidationResult } from './rbac.js';
import { watchRoomDoc } from './intent-watcher.js';
import { WebSocket } from 'ws';
import { collectTaskNotifications, type TaskTodo } from './task-notifications.js';

// Throttles node_updated events (2s cooldown per node ID)
const lastUpdateMap = new Map<string, number>();

// ─── Y.Doc Bootstrap (cold-start replay from Postgres) ───────────────────────

// Tracks in-flight hydrations so concurrent first-connections share one promise
const hydratingRooms = new Map<string, Promise<void>>();

/**
 * Called the first time a client connects to a room whose Y.Doc is empty.
 * Replays all persisted yjs_update events from Postgres to reconstruct state.
 *
 * Concurrent calls for the same room coalesce onto a single in-flight promise
 * so watchers are attached exactly once.
 */
export function hydrateDocFromDB(roomId: string): Promise<void> {
  const room = getRoomOrCreate(roomId);

  // Already fully hydrated
  if ((room.doc as Y.Doc & { _hydrated?: boolean })._hydrated) return Promise.resolve();

  // In-flight hydration — join it instead of starting a second one
  const existing = hydratingRooms.get(roomId);
  if (existing) return existing;

  const promise = _hydrateDocFromDB(roomId).finally(() => {
    hydratingRooms.delete(roomId);
  });
  hydratingRooms.set(roomId, promise);
  return promise;
}

async function _hydrateDocFromDB(roomId: string): Promise<void> {
  const room = getRoomOrCreate(roomId);

  const events = await getEventsSince(roomId, 0, 100_000);

  let yjsCount = 0;
  for (const event of events) {
    if (event.event_type !== 'yjs_update') continue;
    yjsCount++;
    const b64 = (event.payload as { update: string }).update;
    if (!b64) continue;
    const update = Uint8Array.from(Buffer.from(b64, 'base64'));
    try {
      Y.applyUpdate(room.doc, update);
    } catch (err) {
      console.error(`[ydoc-store] Failed to replay event seq=${event.seq}:`, err);
    }
  }

  (room.doc as Y.Doc & { _hydrated?: boolean })._hydrated = true;
  const nodesAfter = room.doc.getMap('nodes').size;
  console.log(`[ydoc-store] Room ${roomId} hydrated: total=${events.length} yjs_updates=${yjsCount} nodes=${nodesAfter}`);

  // Intent updates are now persisted as yjs_update events (actor='__server__'),
  // so they are already restored by the replay loop above. No separate step needed.

  // Start watching for content changes so we can classify intent
  watchRoomDoc(roomId, room.doc);
}

// ─── Apply + Persist + Broadcast ─────────────────────────────────────────────

/**
 * The hot path for every incoming Yjs mutation:
 *  1. RBAC: validate the update against the actor's role + each touched
 *     node's ACL — reject before mutating anything if unauthorised.
 *  2. Apply to the server's authoritative Y.Doc
 *  3. Persist to the events table (async, non-blocking via write buffer)
 *  4. Broadcast the raw delta to all other room members
 *
 * On rejection: send a JSON `rejected` frame back to the sender with the
 * reason and (when possible) the offending node id, then return without
 * applying or broadcasting anything. The sender's WebSocket is the only
 * one notified — other clients never see the unauthorised update.
 */
export function applyAndBroadcast(
  roomId: string,
  senderId: string,
  senderWs: WebSocket,
  actorId: string,
  role: Role,
  update: Uint8Array
): void {
  const room = getRoomOrCreate(roomId);

  // 1. RBAC validation
  const verdict: ValidationResult = validateUpdate(room.doc, update, role);
  if (!verdict.ok) {
    console.warn(
      `[ydoc-store] REJECTED update from actor=${actorId} role=${role} ` +
      `room=${roomId}: ${verdict.reason}` +
      (verdict.nodeId ? ` (node=${verdict.nodeId})` : '')
    );
    safeSendJson(senderWs, {
      type: 'rejected',
      reason: verdict.reason,
      ...(verdict.nodeId ? { nodeId: verdict.nodeId } : {}),
    });
    return;
  }

  // 2. Snapshot node keys BEFORE applying
  const nodesMap = room.doc.getMap<Y.Map<unknown>>('nodes');
  const beforeKeys = new Set<string>(nodesMap.keys());
  
  // Pre-snapshot node types so we know what was deleted
  const beforeTypes = new Map<string, string>();
  const beforeTodos = new Map<string, TaskTodo[]>();
  for (const key of beforeKeys) {
    const map = nodesMap.get(key);
    if (map instanceof Y.Map) {
      beforeTypes.set(key, String(map.get('type') ?? 'node'));
      const todos = map.get('todos');
      if (Array.isArray(todos)) {
        beforeTodos.set(key, todos as TaskTodo[]);
      }
    }
  }

  // Track exact node mutations during the transaction
  const changedKeys = new Set<string>();
  const observer = (events: Y.YEvent<any>[]) => {
    events.forEach(event => {
      if (event.path.length > 0) {
        changedKeys.add(String(event.path[0])); // nested property changed
      } else {
        event.keys.forEach((_, key) => changedKeys.add(key)); // top-level key added/deleted
      }
    });
  };
  nodesMap.observeDeep(observer);

  // 3. Apply to server doc (synchronous)
  try {
    Y.applyUpdate(room.doc, update);
  } catch (err) {
    nodesMap.unobserveDeep(observer);
    console.error(`[ydoc-store] applyUpdate failed for room ${roomId}:`, err);
    return;
  }
  nodesMap.unobserveDeep(observer);

  // 4. Persist raw Yjs update
  persistYjsUpdate(roomId, actorId, update);

  // 5. Log semantic events
  const afterKeys = new Set<string>(nodesMap.keys());

  function nodeLabel(nodeMap: Y.Map<unknown> | undefined): string {
    if (!nodeMap) return '';
    const content = nodeMap.get('content');
    if (content instanceof Y.Text) {
      return content.toString().trim().slice(0, 40) || '';
    }
    return '';
  }

  for (const key of changedKeys) {
    const nodeMap = nodesMap.get(key);
    if (nodeMap instanceof Y.Map) {
      const afterTodos = Array.isArray(nodeMap.get('todos')) ? (nodeMap.get('todos') as TaskTodo[]) : [];
      if (afterTodos.length > 0) {
        const prevTodos = beforeTodos.get(key) ?? [];
        void collectTaskNotifications({
          roomId,
          actorId,
          nodeId: key,
          nodeAuthorId: String(nodeMap.get('author_id') ?? ''),
          nodeContent: (() => {
            const content = nodeMap.get('content');
            if (content instanceof Y.Text) return content.toString();
            if (typeof content === 'string') return content;
            return '';
          })(),
          nodeIntent: nodeMap.get('intent') as string | null | undefined,
          beforeTodos: prevTodos,
          afterTodos,
        }).then((events) => {
          for (const event of events) {
            appendEvent(roomId, actorId, event.event_type, event.payload);
          }
        }).catch((err) => {
          console.error('[ydoc-store] task notification failed:', err);
        });
      }
    }

    if (!beforeKeys.has(key) && afterKeys.has(key)) {
      // Created
      const nodeType = nodeMap instanceof Y.Map ? String(nodeMap.get('type') ?? 'node') : 'node';
      const label = nodeLabel(nodeMap);
      appendEvent(roomId, actorId, 'node_created', { nodeId: key, nodeType, label });
    } else if (beforeKeys.has(key) && !afterKeys.has(key)) {
      // Deleted
      const nodeType = beforeTypes.get(key) ?? 'node';
      appendEvent(roomId, actorId, 'node_deleted', { nodeId: key, nodeType, label: '' });
      lastUpdateMap.delete(key);
    } else if (beforeKeys.has(key) && afterKeys.has(key)) {
      // Updated
      const now = Date.now();
      const last = lastUpdateMap.get(key) || 0;
      if (now - last > 2000) {
        lastUpdateMap.set(key, now);
        const nodeMap = nodesMap.get(key);
        const nodeType = nodeMap instanceof Y.Map ? String(nodeMap.get('type') ?? 'node') : 'node';
        const label = nodeLabel(nodeMap);
        appendEvent(roomId, actorId, 'node_updated', { nodeId: key, nodeType, label });
      }
    }
  }

  // 6. Broadcast binary delta to everyone else in the room
  broadcastToRoom(roomId, senderId, update);

}

function safeSendJson(ws: WebSocket, payload: unknown): void {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error('[ydoc-store] failed to send rejection:', err);
  }
}

// ─── State Accessors ──────────────────────────────────────────────────────────

/** Returns the full current state of the room's Y.Doc as a binary update blob. */
export function encodeRoomState(roomId: string): Uint8Array {
  const room = getRoomOrCreate(roomId);
  return Y.encodeStateAsUpdate(room.doc);
}

/** Returns the state vector of the room Y.Doc (used to compute diffs). */
export function encodeRoomStateVector(roomId: string): Uint8Array {
  const room = getRoomOrCreate(roomId);
  return Y.encodeStateVector(room.doc);
}
