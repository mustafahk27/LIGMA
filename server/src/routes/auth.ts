import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const SALT_ROUNDS = 10;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/register
  app.post('/auth/register', async (request, reply) => {
    const { name, email, password, color } = request.body as {
      name: string;
      email: string;
      password: string;
      color: string;
    };

    if (!name || !email || !password || !color) {
      return reply.status(400).send({ error: 'name, email, password, and color are required' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if ((existing.rowCount ?? 0) > 0) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const userResult = await query<{ id: string; name: string; email: string; color: string }>(
      `INSERT INTO users (name, email, password_hash, color) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, color`,
      [name, email, password_hash, color]
    );

    const user = userResult.rows[0];
    if (!user) return reply.status(500).send({ error: 'Failed to create user' });

    const sessionResult = await query<{ id: string }>(
      `INSERT INTO sessions (user_id) VALUES ($1) RETURNING id`,
      [user.id]
    );

    const token = sessionResult.rows[0]?.id;
    if (!token) return reply.status(500).send({ error: 'Failed to create session' });

    return reply.status(201).send({ user, token });
  });

  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const result = await query<{
      id: string;
      name: string;
      email: string;
      color: string;
      password_hash: string;
    }>(
      `SELECT id, name, email, color, password_hash FROM users WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const sessionResult = await query<{ id: string }>(
      `INSERT INTO sessions (user_id) VALUES ($1) RETURNING id`,
      [user.id]
    );

    const token = sessionResult.rows[0]?.id;
    if (!token) return reply.status(500).send({ error: 'Failed to create session' });

    const { password_hash: _, ...safeUser } = user;
    return reply.send({ user: safeUser, token });
  });

  // POST /auth/logout
  app.post('/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.headers['authorization'];
    const token = auth!.slice(7);
    await query(`DELETE FROM sessions WHERE id = $1`, [token]);
    return reply.send({ success: true });
  });
}
