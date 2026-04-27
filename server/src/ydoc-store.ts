import * as Y from 'yjs';
import { getRoomOrCreate, broadcastToRoom } from './rooms.js';
import { getEventsSince, persistYjsUpdate } from './event-log.js';


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
 *  1. Apply to the server's authoritative Y.Doc
 *  2. Persist to the events table (async, non-blocking via write buffer)
 *  3. Broadcast the raw delta to all other room members
 *
 * Returns the (approximate) seq that will be assigned to this event.
 * The actual seq is written by Postgres BIGSERIAL so it is not known
 * synchronously — we return 0 here and let the client track seq from
 * the 'init' or 'synced' messages instead.
 */
export function applyAndBroadcast(
  roomId: string,
  senderId: string,
  actorId: string,
  update: Uint8Array
): void {
  const room = getRoomOrCreate(roomId);

  // 1. Apply to server doc (this is synchronous and thread-safe in Node.js)
  try {
    Y.applyUpdate(room.doc, update);
  } catch (err) {
    console.error(`[ydoc-store] applyUpdate failed for room ${roomId}:`, err);
    return; // don't persist or broadcast a corrupt update
  }

  // 2. Persist (fire-and-forget via the 200ms write buffer)
  persistYjsUpdate(roomId, actorId, update);

  // 3. Broadcast binary delta to everyone else in the room
  broadcastToRoom(roomId, senderId, update);
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
