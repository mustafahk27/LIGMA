import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import { getEventsSince, getLatestSeq } from './event-log.js';
import { encodeRoomState } from './ydoc-store.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncRequest {
  /** Last event seq the client successfully applied */
  lastSeq: number;
  /**
   * Y.js state vector encoded as a regular number array (JSON-safe).
   * The server uses this to compute the minimal diff.
   */
  stateVector: number[];
}

// ─── First Connect ─────────────────────────────────────────────────────────────

/**
 * Called immediately after a client successfully connects and the room Y.Doc
 * has been hydrated.
 *
 * Sends two frames:
 *   Frame 1 (text): { type: 'init', seq: <latest_seq> }
 *   Frame 2 (binary): full Yjs state as a single update blob
 *
 * The client applies frame 2 with Y.applyUpdate() and records frame 1's seq
 * as its lastSeq checkpoint.
 */
export async function sendFullState(ws: WebSocket, roomId: string): Promise<void> {
  const latestSeq = await getLatestSeq(roomId);
  const fullUpdate = encodeRoomState(roomId);

  // Control frame first so client knows the seq before applying state
  ws.send(JSON.stringify({ type: 'init', seq: latestSeq }));

  // Binary state blob
  if (fullUpdate.byteLength > 0) {
    ws.send(fullUpdate);
  }
}

// ─── Reconnect Replay ─────────────────────────────────────────────────────────

/**
 * Called when a client reconnects and sends { type: 'sync', lastSeq, stateVector }.
 *
 * Instead of re-sending the full state, we compute the minimal diff:
 *   1. Fetch all yjs_update events with seq > lastSeq from Postgres
 *   2. Materialize those events into a temporary Y.Doc starting from current server state
 *   3. Encode only what's missing using Y.encodeStateAsUpdate(tempDoc, clientStateVector)
 *   4. Send the compact diff as a single binary frame
 *
 * If there are no missed events (client is already up-to-date), send nothing —
 * just confirm with a { type: 'synced', seq } JSON frame.
 */
export async function replayMissedEvents(
  ws: WebSocket,
  roomId: string,
  { lastSeq, stateVector }: SyncRequest
): Promise<void> {
  const missedEvents = await getEventsSince(roomId, lastSeq);

  if (missedEvents.length === 0) {
    // Client is already up to date
    const currentSeq = await getLatestSeq(roomId);
    ws.send(JSON.stringify({ type: 'synced', seq: currentSeq }));
    return;
  }

  // Build a temp doc that contains exactly the missed updates
  const tempDoc = new Y.Doc();

  // Start from the server's current authoritative state
  const serverState = encodeRoomState(roomId);
  if (serverState.byteLength > 0) {
    Y.applyUpdate(tempDoc, serverState);
  }

  // Apply each missed event (they're already in causal order from ORDER BY seq ASC)
  for (const event of missedEvents) {
    if (event.event_type !== 'yjs_update') continue;
    const b64 = (event.payload as { update: string }).update;
    if (!b64) continue;
    try {
      const update = Uint8Array.from(Buffer.from(b64, 'base64'));
      Y.applyUpdate(tempDoc, update);
    } catch (err) {
      console.error(`[sync] Failed to apply missed event seq=${event.seq}:`, err);
    }
  }

  // Compute the diff: what does the client need to reach tempDoc's state?
  const clientSv = stateVector.length > 0
    ? new Uint8Array(stateVector)
    : new Uint8Array(0);

  const diff = Y.encodeStateAsUpdate(tempDoc, clientSv);

  const latestSeq = missedEvents[missedEvents.length - 1]?.seq ?? lastSeq;

  // Send the seq update first, then the binary diff
  ws.send(JSON.stringify({ type: 'synced', seq: latestSeq }));

  if (diff.byteLength > 0) {
    ws.send(diff);
  }

  console.log(
    `[sync] Room ${roomId}: replayed ${missedEvents.length} events ` +
    `(seq ${lastSeq + 1}–${latestSeq}), diff size=${diff.byteLength}B`
  );
}
