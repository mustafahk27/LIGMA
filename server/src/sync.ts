import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import { getEventsSince, getLatestSeq } from './event-log.js';
import { encodeRoomState } from './ydoc-store.js';
import { query } from './db.js';

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

/**
 * Maximum events we'll consider for replay. Above this, fall back to a snap.
 * 5000 covers heavy editing sessions; smaller bursts coalesce into batches
 * (see BATCH_WINDOW_MS) so the actual per-tick count is much lower.
 */
const MAX_REPLAY_EVENTS = 5000;

/**
 * Maximum batches we'll animate. Each batch is one visible tick on the client,
 * so this caps the replay duration at ~MAX_REPLAY_BATCHES * tick-interval.
 */
const MAX_REPLAY_BATCHES = 80;

/**
 * Updates whose `created_at` timestamps are within this many ms of one
 * another are merged into a single batch. A drag = many micro-updates that
 * should appear as one visible step.
 */
const BATCH_WINDOW_MS = 250;

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
 * Build the room state as it was at the moment the given seq was applied.
 * Done by replaying every yjs_update event with seq ≤ targetSeq into a fresh
 * temp doc. Returns an empty buffer if there's no history to replay yet.
 */
async function encodeStateAtSeq(roomId: string, targetSeq: number): Promise<Uint8Array> {
  if (targetSeq <= 0) return new Uint8Array(0);
  
  // Targeted query for performance: only fetch yjs_updates for this room up to the target sequence.
  // pg returns BIGINT as string, but Postgres handles the comparison correctly.
  const result = await query< { payload: { update?: string } } >(
    `SELECT payload FROM events 
     WHERE room_id = $1 AND seq <= $2 AND event_type = 'yjs_update' 
     ORDER BY seq ASC`,
    [roomId, targetSeq]
  );
  
  const tempDoc = new Y.Doc();
  for (const row of result.rows) {
    const b64 = row.payload.update;
    if (!b64) continue;
    try {
      Y.applyUpdate(tempDoc, Uint8Array.from(Buffer.from(b64, 'base64')));
    } catch (err) {
      console.error(`[sync] base-state apply failed:`, err);
    }
  }
  return Y.encodeStateAsUpdate(tempDoc);
}

export async function replayMissedEvents(
  ws: WebSocket,
  roomId: string,
  { lastSeq }: SyncRequest
): Promise<void> {
  const latestSeq = await getLatestSeq(roomId);

  // Already at latest — just send a base snap so the client's ydoc is in sync
  // even if it was a fresh page-load (empty ydoc).
  if (latestSeq <= lastSeq) {
    const fullState = encodeRoomState(roomId);
    ws.send(JSON.stringify({
      type: 'replay',
      baseState: Buffer.from(fullState).toString('base64'),
      updates: [],
      finalSeq: latestSeq,
    }));
    return;
  }

  const missedEvents = await getEventsSince(roomId, lastSeq, MAX_REPLAY_EVENTS + 1);

  // Coalesce drag-style micro-updates into time-windowed batches so each
  // visible tick on the client corresponds to one logical change rather than
  // a single mousemove frame.
  const yjsEvents = missedEvents.filter((e) => e.event_type === 'yjs_update');
  const batches: Uint8Array[][] = [];
  let currentBatch: Uint8Array[] = [];
  let batchStartTs = 0;
  for (const ev of yjsEvents) {
    const b64 = (ev.payload as { update?: string }).update;
    if (!b64) continue;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    } catch {
      continue;
    }
    const ts = new Date(ev.created_at).getTime();
    if (currentBatch.length === 0) {
      batchStartTs = ts;
      currentBatch.push(bytes);
    } else if (ts - batchStartTs < BATCH_WINDOW_MS) {
      currentBatch.push(bytes);
    } else {
      batches.push(currentBatch);
      currentBatch = [bytes];
      batchStartTs = ts;
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  const finalSeq = missedEvents[missedEvents.length - 1]?.seq ?? lastSeq;

  // Too many distinct logical changes → snap with the current full state
  if (batches.length > MAX_REPLAY_BATCHES) {
    const fullState = encodeRoomState(roomId);
    ws.send(JSON.stringify({
      type: 'replay',
      baseState: Buffer.from(fullState).toString('base64'),
      updates: [],
      finalSeq: latestSeq,
    }));
    console.log(
      `[sync] Room ${roomId}: ${batches.length} batches > MAX, snapping to seq ${latestSeq}`
    );
    return;
  }

  // Animate: client gets state at lastSeq instantly, then each batch is
  // applied with a small delay so the canvas evolves visibly.
  const baseState = await encodeStateAtSeq(roomId, lastSeq);
  const updates = batches.map((batch) => {
    const merged = batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch);
    return Buffer.from(merged).toString('base64');
  });

  ws.send(JSON.stringify({
    type: 'replay',
    baseState: Buffer.from(baseState).toString('base64'),
    updates,
    finalSeq,
  }));

  console.log(
    `[sync] Room ${roomId}: replay envelope baseState=${baseState.byteLength}B ` +
    `+ ${updates.length} batches from ${yjsEvents.length} updates ` +
    `(seq ${lastSeq + 1}–${finalSeq})`
  );
}
