import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { disconnectUserFromRoom, destroyRoom } from '../rooms.js';

interface Member {
  id: string;
  name: string;
  color: string;
  role: string;
}

interface RoomResponse {
  id: string;
  name: string;
  created_at: Date;
  members: Member[];
}

async function getRoomWithMembers(roomId: string): Promise<RoomResponse | null> {
  const roomResult = await query<{ id: string; name: string; created_at: Date }>(
    `SELECT id, name, created_at FROM rooms WHERE id = $1`,
    [roomId]
  );
  const room = roomResult.rows[0];
  if (!room) return null;

  const membersResult = await query<Member>(
    `SELECT u.id, u.name, u.color, m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = $1`,
    [roomId]
  );

  return { ...room, members: membersResult.rows };
}

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  // POST /rooms — create a room (creator becomes lead)
  app.post('/rooms', { preHandler: requireAuth }, async (request, reply) => {
    const { name } = request.body as { name: string };
    const user = request.user!;

    if (!name) {
      return reply.status(400).send({ error: 'name is required' });
    }

    const roomResult = await query<{ id: string; name: string; created_at: Date }>(
      `INSERT INTO rooms (name) VALUES ($1) RETURNING id, name, created_at`,
      [name]
    );

    const room = roomResult.rows[0];
    if (!room) return reply.status(500).send({ error: 'Failed to create room' });

    await query(
      `INSERT INTO memberships (room_id, user_id, role) VALUES ($1, $2, 'lead')`,
      [room.id, user.id]
    );

    const full = await getRoomWithMembers(room.id);
    return reply.status(201).send(full);
  });

  // GET /rooms — list all rooms the user is a member of
  app.get('/rooms', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;

    const roomIds = await query<{ room_id: string }>(
      `SELECT room_id FROM memberships WHERE user_id = $1`,
      [user.id]
    );

    const list = await Promise.all(
      roomIds.rows.map((r) => getRoomWithMembers(r.room_id))
    );

    return reply.send(list.filter(Boolean));
  });

  // GET /rooms/:id — get room info + members
  app.get('/rooms/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const memberCheck = await query(
      `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if ((memberCheck.rowCount ?? 0) === 0) {
      return reply.status(403).send({ error: 'You are not a member of this room' });
    }

    const room = await getRoomWithMembers(id);
    if (!room) return reply.status(404).send({ error: 'Room not found' });

    const seqResult = await query<{ latest_seq: string }>(
      `SELECT COALESCE(MAX(seq), 0)::text AS latest_seq FROM events WHERE room_id = $1`,
      [id]
    );
    const latestSeq = Number(seqResult.rows[0]?.latest_seq ?? '0');

    await query(
      `INSERT INTO user_room_reads (room_id, user_id, last_seen_seq, last_seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET
         last_seen_seq = GREATEST(user_room_reads.last_seen_seq, EXCLUDED.last_seen_seq),
         last_seen_at = NOW()`,
      [id, user.id, latestSeq]
    );

    return reply.send(room);
  });

  // GET /rooms/:id/events — event log for the sidebar (newest first, excludes raw yjs_update blobs)
  app.get('/rooms/:id/events', { preHandler: requireAuth }, async (request, reply) => {
    const { id: room_id } = request.params as { id: string };
    const { after_seq = '0', limit = '80' } = request.query as {
      after_seq?: string;
      limit?: string;
    };
    const user = request.user!;

    const memberCheck = await query(
      `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
      [room_id, user.id]
    );
    if ((memberCheck.rowCount ?? 0) === 0) {
      return reply.status(403).send({ error: 'Not a member' });
    }

    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 80), 200);
    const afterSeq   = Math.max(0, parseInt(after_seq, 10) || 0);

    const result = await query<{
      id: string;
      seq: number;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: string;
      actor_name: string;
      actor_color: string;
    }>(
      `SELECT e.id, e.seq, e.event_type, e.payload, e.created_at,
              u.name AS actor_name, u.color AS actor_color
       FROM events e
       JOIN users u ON u.id = e.actor_id
       WHERE e.room_id = $1
         AND e.seq > $2
         AND e.event_type != 'yjs_update'
       ORDER BY e.seq DESC
       LIMIT $3`,
      [room_id, afterSeq, safeLimit]
    );

    const latest_seq = result.rows[0]?.seq ?? afterSeq;
    return reply.send({ events: result.rows, latest_seq });
  });

  // POST /rooms/:id/leave — remove current user from the room memberships
  app.post('/rooms/:id/leave', { preHandler: requireAuth }, async (request, reply) => {
    const { id: room_id } = request.params as { id: string };
    const user = request.user!;

    disconnectUserFromRoom(room_id, user.id);

    const res = await query(
      `DELETE FROM memberships WHERE room_id = $1 AND user_id = $2 RETURNING id`,
      [room_id, user.id]
    );

    if ((res.rowCount ?? 0) === 0) {
      return reply.status(404).send({ error: 'Not a member of this room' });
    }

    return reply.status(204).send();
  });

  // DELETE /rooms/:id — delete a room (only lead can delete)
  app.delete('/rooms/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const memberCheck = await query(
      `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
      [id, user.id]
    );
    if ((memberCheck.rowCount ?? 0) === 0) {
      return reply.status(403).send({ error: 'Not a member' });
    }
    const role = memberCheck.rows[0]?.role;
    if (!role) {
      return reply.status(403).send({ error: 'Not a member' });
    }
    if (role !== 'lead') {
      return reply.status(403).send({ error: 'Only a lead may delete the room' });
    }

    destroyRoom(id);

    await query(`DELETE FROM rooms WHERE id = $1`, [id]);
    return reply.status(204).send();
  });
}
