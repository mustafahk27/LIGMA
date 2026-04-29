import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { query } from './db.js';
import type { AuthUser } from './middleware/auth.js';
import { joinRoom, leaveRoom, broadcastJsonToRoom, roomSize, getClientRole, getRoomDoc } from './rooms.js';
import type { Role } from './rbac.js';
import { hydrateDocFromDB, applyAndBroadcast } from './ydoc-store.js';
import { sendFullState, replayMissedEvents } from './sync.js';
import type { SyncRequest } from './sync.js';
import { randomUUID } from 'crypto';
import * as awarenessProtocol from 'y-protocols/awareness';

// ─── Types ────────────────────────────────────────────────────────────────────

/** JSON messages the client CAN send to the server */
type ClientJsonMessage =
  | { type: 'sync'; lastSeq: number; stateVector: number[] }
  | { type: 'awareness'; data: number[] };

// ─── Awareness relay state (room presence) ──────────────────────────────────

const roomAwareness = new Map<string, awarenessProtocol.Awareness>();
const connectionAwarenessIds = new Map<string, Set<number>>();

function awarenessKey(roomId: string, clientId: string): string {
  return `${roomId}:${clientId}`;
}

function getRoomAwareness(roomId: string): awarenessProtocol.Awareness {
  const existing = roomAwareness.get(roomId);
  if (existing) return existing;
  const doc = getRoomDoc(roomId);
  if (!doc) {
    throw new Error(`Missing room doc for awareness relay: ${roomId}`);
  }
  const created = new awarenessProtocol.Awareness(doc);
  roomAwareness.set(roomId, created);
  return created;
}

function trackConnectionAwareness(
  roomId: string,
  clientId: string,
  changes: { added: number[]; updated: number[]; removed: number[] },
): void {
  const key = awarenessKey(roomId, clientId);
  const known = connectionAwarenessIds.get(key) ?? new Set<number>();
  for (const id of changes.added) known.add(id);
  for (const id of changes.updated) known.add(id);
  for (const id of changes.removed) known.delete(id);

  if (known.size > 0) {
    connectionAwarenessIds.set(key, known);
  } else {
    connectionAwarenessIds.delete(key);
  }
}

function removeConnectionAwareness(roomId: string, clientId: string): void {
  const key = awarenessKey(roomId, clientId);
  const known = connectionAwarenessIds.get(key);
  if (!known || known.size === 0) {
    connectionAwarenessIds.delete(key);
    return;
  }

  const aw = getRoomAwareness(roomId);
  const ids = [...known];

  awarenessProtocol.removeAwarenessStates(aw, ids, clientId);
  const encoded = awarenessProtocol.encodeAwarenessUpdate(aw, ids);
  broadcastJsonToRoom(roomId, clientId, {
    type: 'awareness',
    data: Array.from(encoded),
  });

  connectionAwarenessIds.delete(key);
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Validate a session token from the query string and return the user.
 * Mirrors requireAuth middleware but works outside Fastify request context.
 */
async function authenticateToken(token: string): Promise<AuthUser | null> {
  const result = await query<AuthUser>(
    `SELECT u.id, u.name, u.email, u.color
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [token]
  );
  return result.rows[0] ?? null;
}

/**
 * Check that the user is a member of the room.
 * Returns their role or null if they are not a member.
 */
async function getRoomRole(
  roomId: string,
  userId: string
): Promise<string | null> {
  const result = await query<{ role: string }>(
    `SELECT role FROM memberships WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
  return result.rows[0]?.role ?? null;
}

// ─── Per-connection message handler ──────────────────────────────────────────

function handleConnection(
  ws: WebSocket,
  roomId: string,
  clientId: string,
  user: AuthUser,
  role: Role
): void {
  console.log(`[ws] ${user.name} (${clientId}, ${role}) connected to room ${roomId} (${roomSize(roomId)} total)`);

  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // Normalise to Buffer
    const data = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw);

    if (isBinary) {
      // ── Binary frame → Yjs update delta ──────────────────────────────────
      // Re-read the role on every message so role changes between sessions
      // (or future role mutations) are picked up without reconnecting.
      const liveRole = getClientRole(roomId, clientId) ?? role;
      const update = new Uint8Array(data);
      applyAndBroadcast(roomId, clientId, ws, user.id, liveRole, update);
      return;
    }

    // ── Text frame → JSON control message ────────────────────────────────
    let msg: ClientJsonMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientJsonMessage;
    } catch {
      console.warn(`[ws] Non-JSON text frame from ${clientId}, ignoring`);
      return;
    }

    switch (msg.type) {
      case 'sync': {
        // Client reconnected and wants to catch up
        const req: SyncRequest = {
          lastSeq: msg.lastSeq ?? 0,
          stateVector: msg.stateVector ?? [],
        };
        void replayMissedEvents(ws, roomId, req);
        break;
      }

      case 'awareness': {
        // Cursor / presence update — relay to all other room members.
        // We also track awareness client IDs per websocket so disconnects can
        // broadcast immediate removal (instead of waiting for timeout expiry).
        const aw = getRoomAwareness(roomId);
        const update = new Uint8Array(msg.data);
        let ownChanges: { added: number[]; updated: number[]; removed: number[] } = {
          added: [],
          updated: [],
          removed: [],
        };
        const onUpdate = (
          changes: { added: number[]; updated: number[]; removed: number[] },
          origin: unknown,
        ) => {
          if (origin !== clientId) return;
          ownChanges = changes;
        };
        aw.on('update', onUpdate);
        awarenessProtocol.applyAwarenessUpdate(aw, update, clientId);
        aw.off('update', onUpdate);
        trackConnectionAwareness(roomId, clientId, ownChanges);

        broadcastJsonToRoom(roomId, clientId, {
          type: 'awareness',
          data: msg.data,
        });
        break;
      }

      default: {
        console.warn(`[ws] Unknown message type from ${clientId}:`, (msg as Record<string, unknown>).type);
      }
    }
  });

  ws.on('close', (code, reason) => {
    removeConnectionAwareness(roomId, clientId);
    leaveRoom(roomId, clientId);
    console.log(
      `[ws] ${user.name} (${clientId}) left room ${roomId} ` +
        `(code=${code}, reason=${reason.toString() || 'none'}, ${roomSize(roomId)} remaining)`
    );
  });

  ws.on('error', (err) => {
    console.error(`[ws] Error on ${clientId}:`, err);
    removeConnectionAwareness(roomId, clientId);
    leaveRoom(roomId, clientId);
  });
}

// ─── Upgrade Handler (called from index.ts) ───────────────────────────────────

// Matches /ws/<uuid> — query string is NOT part of the path and must be parsed separately.
const WS_PATH_RE = /^\/ws\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * Returns the 'upgrade' event handler to attach to Fastify's raw HTTP server.
 *
 * Usage in index.ts:
 *   app.server.on('upgrade', createUpgradeHandler(wss));
 */
export function createUpgradeHandler(wss: WebSocketServer) {
  return async function handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    const url = request.url ?? '';

    // Split path from query string first, then match path
    const [rawPath, rawQuery] = url.split('?') as [string, string | undefined];
    const match = WS_PATH_RE.exec(rawPath ?? '');
    if (!match) {
      console.warn('[ws] upgrade rejected: path not /ws/<uuid>', rawPath);
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const roomId = match[1]!;

    // ── Parse ?token= from query string ──────────────────────────────────
    const qs = new URLSearchParams(rawQuery ?? '');
    const token = qs.get('token');
    const lastSeqParam = parseInt(qs.get('lastSeq') ?? '0', 10);
    const isReconnect = Number.isFinite(lastSeqParam) && lastSeqParam > 0;

    if (!token) {
      console.warn('[ws] upgrade rejected: missing ?token=');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // ── DB: validate session token ────────────────────────────────────────
    let user: AuthUser | null;
    try {
      user = await authenticateToken(token);
    } catch (err) {
      console.error('[ws] Auth DB error:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!user) {
      console.warn('[ws] upgrade rejected: invalid or expired session token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // ── DB: check room membership ─────────────────────────────────────────
    let role: string | null;
    try {
      role = await getRoomRole(roomId, user.id);
    } catch (err) {
      console.error('[ws] Membership DB error:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!role) {
      console.warn(`[ws] upgrade rejected: user ${user.id} not a member of room ${roomId}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // ── Hydrate the room Y.Doc from Postgres (no-op if already loaded) ────
    try {
      await hydrateDocFromDB(roomId);
    } catch (err) {
      console.error('[ws] Y.Doc hydration error:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      return;
    }

    // ── All checks passed: complete the WebSocket upgrade ─────────────────
    const clientRole = role as Role;
    wss.handleUpgrade(request, socket, head, (ws) => {
      const clientId = randomUUID();

      // Register the client BEFORE sending state so broadcastToRoom works
      joinRoom(roomId, clientId, ws, user!, clientRole);

      // Fresh connection: send full state immediately (init + binary).
      // Reconnect: skip auto state — client will send `sync` and we'll respond
      // with a step-by-step replay envelope so the canvas can animate it.
      if (!isReconnect) {
        void sendFullState(ws, roomId);
      }

      // Start the per-connection message loop
      handleConnection(ws, roomId, clientId, user!, clientRole);

      wss.emit('connection', ws, request);
    });
  };
}
