import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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

    return reply.send(room);
  });
}
