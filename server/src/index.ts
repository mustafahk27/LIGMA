import Fastify from 'fastify';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { inviteRoutes } from './routes/invites.js';
import { createUpgradeHandler } from './ws.js';

dotenv.config();

const app = Fastify({ logger: true });

await app.register(authRoutes);
await app.register(roomRoutes);
await app.register(inviteRoutes);

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
