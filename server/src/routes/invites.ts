import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  // GET /invites/:token — fetch invite info (public, no auth required)
  app.get('/invites/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const result = await query<{
      room_id: string;
      room_name: string;
      role: string;
      inviter_name: string;
      accepted_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT i.room_id, r.name AS room_name, i.role,
              u.name AS inviter_name, i.accepted_at, i.expires_at
       FROM invites i
       JOIN rooms r ON r.id = i.room_id
       JOIN users u ON u.id = i.invited_by
       WHERE i.token = $1`,
      [token]
    );

    const invite = result.rows[0];
    if (!invite) return reply.status(404).send({ error: 'Invite not found' });
    if (invite.accepted_at) return reply.status(409).send({ error: 'Invite already accepted' });
    if (new Date() > new Date(invite.expires_at)) return reply.status(410).send({ error: 'Invite has expired' });

    return reply.send({
      room: { id: invite.room_id, name: invite.room_name },
      role: invite.role,
      inviter: { name: invite.inviter_name },
    });
  });

  // POST /rooms/:id/invite — lead invites someone by email
  app.post('/rooms/:id/invite', { preHandler: requireAuth }, async (request, reply) => {
    const { id: room_id } = request.params as { id: string };
    const { email, role = 'contributor' } = request.body as { email: string; role?: string };
    const user = request.user!;

    if (!email) {
      return reply.status(400).send({ error: 'email is required' });
    }

    if (!['contributor', 'viewer'].includes(role)) {
      return reply.status(400).send({ error: 'role must be contributor or viewer' });
    }

    // Only leads can invite
    const memberCheck = await query(
      `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
      [room_id, user.id]
    );

    if (memberCheck.rows[0]?.role !== 'lead') {
      return reply.status(403).send({ error: 'Only leads can invite members' });
    }

    // Check room exists
    const roomCheck = await query(`SELECT id FROM rooms WHERE id = $1`, [room_id]);
    if ((roomCheck.rowCount ?? 0) === 0) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    // Check not already a member
    const existingUser = await query<{ id: string }>(
      `SELECT u.id FROM users u
       JOIN memberships m ON m.user_id = u.id
       WHERE u.email = $1 AND m.room_id = $2`,
      [email, room_id]
    );

    if ((existingUser.rowCount ?? 0) > 0) {
      return reply.status(409).send({ error: 'User is already a member of this room' });
    }

    // Upsert invite (re-invite refreshes the token + expiry)
    const inviteResult = await query<{ token: string }>(
      `INSERT INTO invites (room_id, invited_by, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING token`,
      [room_id, user.id, email, role]
    );

    const token = inviteResult.rows[0]?.token;
    if (!token) return reply.status(500).send({ error: 'Failed to create invite' });

    return reply.status(201).send({
      invite_link: `/invite/${token}`,
      email,
      role,
      expires_in: '48 hours',
    });
  });

  // POST /invites/:token/accept — logged-in user accepts an invite
  app.post('/invites/:token/accept', { preHandler: requireAuth }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const user = request.user!;

    const inviteResult = await query<{
      id: string;
      room_id: string;
      email: string;
      role: string;
      accepted_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, room_id, email, role, accepted_at, expires_at
       FROM invites WHERE token = $1`,
      [token]
    );

    const invite = inviteResult.rows[0];

    if (!invite) {
      return reply.status(404).send({ error: 'Invite not found' });
    }

    if (invite.accepted_at) {
      return reply.status(409).send({ error: 'Invite already accepted' });
    }

    if (new Date() > new Date(invite.expires_at)) {
      return reply.status(410).send({ error: 'Invite has expired' });
    }

    if (invite.email !== user.email) {
      return reply.status(403).send({ error: 'This invite was sent to a different email' });
    }

    // Create membership
    await query(
      `INSERT INTO memberships (room_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [invite.room_id, user.id, invite.role]
    );

    // Mark invite as accepted
    await query(
      `UPDATE invites SET accepted_at = NOW() WHERE id = $1`,
      [invite.id]
    );

    return reply.send({ room_id: invite.room_id, role: invite.role });
  });
}
