import { query } from './db.js';

export type EventType =
  | 'yjs_update'
  | 'node_created'
  | 'node_updated'
  | 'node_deleted'
  | 'node_locked'
  | 'node_unlocked'
  | 'intent_classified';

export interface AppEvent {
  id: string;
  room_id: string;
  actor_id: string;
  seq: number;
  event_type: EventType;
  payload: Record<string, unknown>;
  created_at: Date;
}

// Write buffer — batches inserts every 200ms to avoid hammering the DB
interface PendingEvent {
  room_id: string;
  actor_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
}

const writeBuffer: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBuffer();
  }, 200);
}

async function flushBuffer(): Promise<void> {
  if (writeBuffer.length === 0) return;

  const batch = writeBuffer.splice(0, writeBuffer.length);

  const values: unknown[] = [];
  const placeholders = batch.map((e, i) => {
    const base = i * 4;
    values.push(e.room_id, e.actor_id, e.event_type, JSON.stringify(e.payload));
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  try {
    await query(
      `INSERT INTO events (room_id, actor_id, event_type, payload) VALUES ${placeholders.join(', ')}`,
      values
    );
  } catch (err) {
    console.error('[event-log] flushBuffer failed, requeueing batch:', err);
    // Put items back so they're retried on the next flush
    writeBuffer.unshift(...batch);
  }
}

export function appendEvent(
  room_id: string,
  actor_id: string,
  event_type: EventType,
  payload: Record<string, unknown>
): void {
  writeBuffer.push({ room_id, actor_id, event_type, payload });
  scheduleFlush();
}

/**
 * Convenience wrapper for persisting a raw Yjs binary update to the event log.
 * The binary data is base64-encoded so it can live as a JSONB value in Postgres.
 */
export function persistYjsUpdate(
  room_id: string,
  actor_id: string,
  update: Uint8Array
): void {
  appendEvent(room_id, actor_id, 'yjs_update', {
    update: Buffer.from(update).toString('base64'),
  });
}

export async function getEventsSince(
  room_id: string,
  after_seq: number,
  limit = 100
): Promise<AppEvent[]> {
  const result = await query<AppEvent>(
    `SELECT * FROM events WHERE room_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [room_id, after_seq, limit]
  );
  return result.rows;
}

export async function getLatestSeq(room_id: string): Promise<number> {
  const result = await query<{ seq: number }>(
    `SELECT seq FROM events WHERE room_id = $1 ORDER BY seq DESC LIMIT 1`,
    [room_id]
  );
  return result.rows[0]?.seq ?? 0;
}
