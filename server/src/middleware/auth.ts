import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  color: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = request.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    await reply.status(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = auth.slice(7);

  const result = await query<AuthUser & { session_id: string }>(
    `SELECT u.id, u.name, u.email, u.color
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [token]
  );

  if (result.rows.length === 0) {
    await reply.status(401).send({ error: 'Invalid or expired session' });
    return;
  }

  if (result.rows[0]) request.user = result.rows[0];
}
