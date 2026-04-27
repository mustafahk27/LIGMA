import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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

    return reply.status(201).send({ room });
  });

  // GET /rooms/:id — get room info + members
  app.get('/rooms/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    // Check user is a member
    const memberCheck = await query(
      `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if ((memberCheck.rowCount ?? 0) === 0) {
      return reply.status(403).send({ error: 'You are not a member of this room' });
    }

    const roomResult = await query<{ id: string; name: string; created_at: Date }>(
      `SELECT id, name, created_at FROM rooms WHERE id = $1`,
      [id]
    );

    const room = roomResult.rows[0];
    if (!room) return reply.status(404).send({ error: 'Room not found' });

    const membersResult = await query<{
      user_id: string;
      name: string;
      color: string;
      role: string;
    }>(
      `SELECT u.id as user_id, u.name, u.color, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.room_id = $1`,
      [id]
    );

    return reply.send({ room, members: membersResult.rows, your_role: memberCheck.rows[0]?.role });
  });
}
