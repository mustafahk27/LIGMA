import { WebSocket } from 'ws';
import type { AuthUser } from './middleware/auth.js';
import * as Y from 'yjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoomClient {
  ws: WebSocket;
  user: AuthUser;
  /** Last event seq the client has confirmed receiving */
  lastSeq: number;
}

export interface Room {
  /** All currently connected WebSocket clients, keyed by a random clientId */
  clients: Map<string, RoomClient>;
  /** The authoritative in-memory Y.Doc for this room */
  doc: Y.Doc;
}

// ─── In-Memory Registry ────────────────────────────────────────────────────────

const rooms = new Map<string, Room>();

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Returns the room entry, creating it (with a fresh Y.Doc) if it doesn't exist yet.
 * The doc will be hydrated from Postgres by sync.ts before any client is admitted.
 */
export function getRoomOrCreate(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      clients: new Map(),
      doc: new Y.Doc(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

/**
 * Add a newly connected client to the room's client set.
 * Returns the client ID assigned.
 */
export function joinRoom(
  roomId: string,
  clientId: string,
  ws: WebSocket,
  user: AuthUser,
  lastSeq: number = 0
): void {
  const room = getRoomOrCreate(roomId);
  room.clients.set(clientId, { ws, user, lastSeq });
}

/**
 * Remove a client from the room when it disconnects.
 * The Y.Doc is intentionally kept alive — other clients may still be connected,
 * and if none are, the doc acts as a cache until the next connection triggers
 * a potential cold-start reload from Postgres.
 */
export function leaveRoom(roomId: string, clientId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(clientId);
  // Note: we do NOT delete the room entry. The Y.Doc stays in memory so
  // the next reconnect doesn't have to replay from Postgres.
}

/**
 * Send a binary frame to every connected client in the room EXCEPT the sender.
 */
export function broadcastToRoom(
  roomId: string,
  senderId: string,
  data: Uint8Array
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const [clientId, client] of room.clients) {
    if (clientId === senderId) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(data);
  }
}

/**
 * Send a JSON control message to every client in the room EXCEPT the sender.
 */
export function broadcastJsonToRoom(
  roomId: string,
  senderId: string,
  payload: unknown
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const text = JSON.stringify(payload);
  for (const [clientId, client] of room.clients) {
    if (clientId === senderId) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(text);
  }
}

/**
 * Returns the Y.Doc for a room, or undefined if the room hasn't been
 * initialised yet (should never happen after ws.ts runs).
 */
export function getRoomDoc(roomId: string): Y.Doc | undefined {
  return rooms.get(roomId)?.doc;
}

/**
 * Update the stored lastSeq for a client (called after a successful event write).
 */
export function updateClientSeq(
  roomId: string,
  clientId: string,
  seq: number
): void {
  const client = rooms.get(roomId)?.clients.get(clientId);
  if (client) client.lastSeq = seq;
}

/** How many clients are currently connected to a room (useful for logging). */
export function roomSize(roomId: string): number {
  return rooms.get(roomId)?.clients.size ?? 0;
}
