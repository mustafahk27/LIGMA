import * as Y from 'yjs';
import { getRoomOrCreate, broadcastToRoom } from './rooms.js';
import { getEventsSince, persistYjsUpdate } from './event-log.js';
import { validateUpdate, type Role, type ValidationResult } from './rbac.js';
import { WebSocket } from 'ws';


// ─── Y.Doc Bootstrap (cold-start replay from Postgres) ───────────────────────

/**
 * Called the first time a client connects to a room whose Y.Doc is empty.
 * Replays all persisted yjs_update events from Postgres to reconstruct state.
 *
 * Multiple concurrent first-connections won't double-apply because joinRoom
 * is gated until this resolves (see ws.ts).
 */
export async function hydrateDocFromDB(roomId: string): Promise<void> {
  const room = getRoomOrCreate(roomId);

  // Already hydrated or has live clients who seeded it
  if ((room.doc as Y.Doc & { _hydrated?: boolean })._hydrated) return;

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
