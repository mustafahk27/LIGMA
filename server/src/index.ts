import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { inviteRoutes } from './routes/invites.js';
import { exportRoutes } from './routes/export.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { createUpgradeHandler } from './ws.js';

dotenv.config();

const app = Fastify({ logger: true });

/** Comma-separated list in ALLOWED_ORIGIN, e.g. http://localhost:3000,http://127.0.0.1:3000 */
function corsOrigin(): string | string[] | boolean {
  const raw = process.env['ALLOWED_ORIGIN']?.trim();
  if (!raw) return 'http://localhost:3000';
  if (raw === '*') return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0]! : list;
}

await app.register(cors, {
  origin: corsOrigin(),
  credentials: true,
});

await app.register(authRoutes);
await app.register(roomRoutes);
await app.register(inviteRoutes);
await app.register(exportRoutes);
await app.register(dashboardRoutes);

const PORT = Number(process.env['PORT'] ?? 3001);

// Create a WS server in 'noServer' mode so we own the upgrade handshake.
// This lets us authenticate the token BEFORE the WebSocket is accepted.
const wss = new WebSocketServer({ noServer: true });

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);

  // Attach the WS upgrade handler to Fastify's raw Node HTTP server.
  // Must be done AFTER listen() so app.server is populated.
  app.server.on('upgrade', createUpgradeHandler(wss));
  console.log('WebSocket server attached');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
