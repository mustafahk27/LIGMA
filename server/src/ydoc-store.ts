import * as Y from 'yjs';
import { getRoomOrCreate, broadcastToRoom } from './rooms.js';
import { getEventsSince, persistYjsUpdate } from './event-log.js';
import { validateUpdate, type Role, type ValidationResult } from './rbac.js';
import { watchRoomDoc } from './intent-watcher.js';
import { query } from './db.js';
import { WebSocket } from 'ws';


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

  for (const event of events) {
    if (event.event_type !== 'yjs_update') continue;
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
  console.log(`[ydoc-store] Room ${roomId} hydrated with ${events.length} events`);

  // Re-apply persisted intents from canvas_nodes into the Y.Doc.
  // The intent writes from the classifier are NOT in the yjs_update event log,
  // so after a server restart the Y.Doc would have nodes with no intent fields.
  // Querying canvas_nodes and writing them back here fixes that.
  await rehydrateIntents(roomId, room.doc);

  // Start watching for content changes so we can classify intent
  watchRoomDoc(roomId, room.doc);
}

// ─── Intent rehydration (cold-start) ─────────────────────────────────────────

/**
 * After replaying yjs_update events, the Y.Doc has all canvas content but no
 * intent fields (those are written server-side and never go into the event log).
 * This function reads the persisted intents from canvas_nodes and writes them
 * back into the Y.Doc so badges survive a server restart.
 */
async function rehydrateIntents(roomId: string, doc: Y.Doc): Promise<void> {
  let rows: Array<{ id: string; intent: string }>;
  try {
    const result = await query<{ id: string; intent: string }>(
      `SELECT id, intent FROM canvas_nodes
       WHERE room_id = $1 AND intent IS NOT NULL AND deleted_at IS NULL`,
      [roomId]
    );
    rows = result.rows;
  } catch (err) {
    console.error(`[ydoc-store] rehydrateIntents query failed for room ${roomId}:`, err);
    return;
  }

  if (rows.length === 0) return;

  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  doc.transact(() => {
    for (const { id, intent } of rows) {
      const nodeMap = nodes.get(id);
      if (nodeMap instanceof Y.Map) {
        nodeMap.set('intent', intent);
      }
    }
  });

  console.log(`[ydoc-store] Rehydrated ${rows.length} intents for room ${roomId}`);
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

  // 2. Apply to server doc (synchronous — single-threaded Node)
  try {
    Y.applyUpdate(room.doc, update);
  } catch (err) {
    console.error(`[ydoc-store] applyUpdate failed for room ${roomId}:`, err);
    return; // don't persist or broadcast a corrupt update
  }

  // 3. Persist (fire-and-forget via the 200ms write buffer)
  persistYjsUpdate(roomId, actorId, update);

  // 4. Broadcast binary delta to everyone else in the room
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
