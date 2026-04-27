import Fastify from 'fastify';
import dotenv from 'dotenv';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { inviteRoutes } from './routes/invites.js';

dotenv.config();

const app = Fastify({ logger: true });

await app.register(authRoutes);
await app.register(roomRoutes);
await app.register(inviteRoutes);

const PORT = Number(process.env['PORT'] ?? 3001);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
