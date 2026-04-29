import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hydrateDocFromDB } from '../ydoc-store.js';
import { getRoomDoc } from '../rooms.js';

type TaskStatus = 'open' | 'inprogress' | 'completed' | 'closed';

//types
interface MembershipRow {
  room_id: string;
  room_name: string;
  member_count: string;
  latest_seq: string;
  last_seen_seq: string;
  last_seen_at: string | null;
  latest_event_at: string | null;
}

interface RoomTaskStats {
  total: number;
  open: number;
  inprogress: number;
  completed: number;
  closed: number;
  assignedToUser: number;
  assignedOpenToUser: number;
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  if (value === 'in_progress' || value === 'inprogress') return 'inprogress';
  if (value === 'completed' || value === 'closed' || value === 'open') return value;
  return 'open';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

async function getRoomTaskStats(roomId: string, userId: string): Promise<RoomTaskStats> {
  await hydrateDocFromDB(roomId);
  const doc = getRoomDoc(roomId);
  if (!doc) {
    return {
      total: 0,
      open: 0,
      inprogress: 0,
      completed: 0,
      closed: 0,
      assignedToUser: 0,
      assignedOpenToUser: 0,
    };
  }

  const stats: RoomTaskStats = {
    total: 0,
    open: 0,
    inprogress: 0,
    completed: 0,
    closed: 0,
    assignedToUser: 0,
    assignedOpenToUser: 0,
  };

  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  for (const [, nodeMap] of nodes) {
    if (!(nodeMap instanceof Y.Map)) continue;
    const todos = nodeMap.get('todos');
    if (!Array.isArray(todos)) continue;

    for (const todo of todos) {
      const row = asRecord(todo);
      if (!row) continue;

      const status = normalizeTaskStatus(row.status);
      stats.total += 1;
      stats[status] += 1;

      const assigneeId = typeof row.assigneeId === 'string' ? row.assigneeId : null;
      if (assigneeId === userId) {
        stats.assignedToUser += 1;
        if (status === 'open' || status === 'inprogress') {
          stats.assignedOpenToUser += 1;
        }
      }
    }
  }

  return stats;
}

async function getMembershipRows(userId: string): Promise<MembershipRow[]> {
  const result = await query<MembershipRow>(
    `SELECT m.room_id,
            r.name AS room_name,
            COUNT(DISTINCT m2.user_id)::text AS member_count,
            COALESCE(MAX(e.seq), 0)::text AS latest_seq,
            COALESCE(urr.last_seen_seq, 0)::text AS last_seen_seq,
            urr.last_seen_at::text AS last_seen_at,
            MAX(e.created_at)::text AS latest_event_at
     FROM memberships m
     JOIN rooms r ON r.id = m.room_id
     LEFT JOIN memberships m2 ON m2.room_id = m.room_id
     LEFT JOIN events e ON e.room_id = m.room_id
     LEFT JOIN user_room_reads urr
       ON urr.room_id = m.room_id AND urr.user_id = $1
     WHERE m.user_id = $1
     GROUP BY m.room_id, r.name, urr.last_seen_seq, urr.last_seen_at
     ORDER BY r.name ASC`,
    [userId]
  );

  return result.rows;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/rooms', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const rows = await getMembershipRows(user.id);

    const rooms = await Promise.all(
      rows.map(async (row) => {
        const latestSeq = Number(row.latest_seq ?? '0');
        const lastSeenSeq = Number(row.last_seen_seq ?? '0');
        const stats = await getRoomTaskStats(row.room_id, user.id);
        return {
          room_id: row.room_id,
          room_name: row.room_name,
          member_count: Number(row.member_count ?? '0'),
          total_tasks: stats.total,
          open_tasks: stats.open,
          inprogress_tasks: stats.inprogress,
          completed_tasks: stats.completed,
          closed_tasks: stats.closed,
          completion_rate: stats.total > 0 ? Math.round(((stats.completed + stats.closed) / stats.total) * 100) : 0,
          latest_seq: latestSeq,
          last_seen_seq: lastSeenSeq,
          missed_updates: Math.max(0, latestSeq - lastSeenSeq),
          last_seen_at: row.last_seen_at,
          updated_at: row.latest_event_at,
        };
      })
    );

    return reply.send({ rooms });
  });

  app.get('/dashboard/user', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const rows = await getMembershipRows(user.id);

    const rooms = await Promise.all(
      rows.map(async (row) => {
        const latestSeq = Number(row.latest_seq ?? '0');
        const lastSeenSeq = Number(row.last_seen_seq ?? '0');
        const missed = Math.max(0, latestSeq - lastSeenSeq);
        const stats = await getRoomTaskStats(row.room_id, user.id);

        return {
          room_id: row.room_id,
          room_name: row.room_name,
          member_count: Number(row.member_count ?? '0'),
          missed_updates: missed,
          latest_seq: latestSeq,
          last_seen_seq: lastSeenSeq,
          assigned_to_me: stats.assignedToUser,
          assigned_open_to_me: stats.assignedOpenToUser,
          total_tasks: stats.total,
          completed_tasks: stats.completed,
          closed_tasks: stats.closed,
          updated_at: row.latest_event_at,
          last_seen_at: row.last_seen_at,
        };
      })
    );

    const summary = rooms.reduce(
      (acc, room) => {
        acc.total_rooms += 1;
        acc.rooms_with_missed_updates += room.missed_updates > 0 ? 1 : 0;
        acc.total_missed_updates += room.missed_updates;
        acc.assigned_to_me += room.assigned_to_me;
        acc.assigned_open_to_me += room.assigned_open_to_me;
        return acc;
      },
      {
        total_rooms: 0,
        rooms_with_missed_updates: 0,
        total_missed_updates: 0,
        assigned_to_me: 0,
        assigned_open_to_me: 0,
      }
    );

    rooms.sort((a, b) => {
      if (b.missed_updates !== a.missed_updates) return b.missed_updates - a.missed_updates;
      return b.assigned_open_to_me - a.assigned_open_to_me;
    });

    return reply.send({ summary, rooms });
  });
}
