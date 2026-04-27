# LIGMA — Change Log

> Session: WebSocket & Real-Time Sync (Features 1, 2, 7, 8)
> Date: 2026-04-27
>
> **Session log / score checklist:** [`implementation.md`](./implementation.md) → *Session Log* and *Score Tracking*.

---

## Overview

Implemented the full WebSocket layer on top of the existing auth/room/invite system.
Covers bare WS server (F1), Yjs document sync (F2), event log persistence (F7), and
reconnect-with-replay (F8).

---

## Server — New Files

### `server/src/rooms.ts`
In-memory room registry.

- Defines `Room` type: `{ clients: Map<clientId, RoomClient>, doc: Y.Doc }`
- `getRoomOrCreate(roomId)` — lazy-initialises a room with a fresh `Y.Doc`
- `joinRoom(roomId, clientId, ws, user)` — registers a new WS connection
- `leaveRoom(roomId, clientId)` — removes a client on disconnect; Y.Doc is intentionally kept alive for reconnects
- `broadcastToRoom(roomId, senderId, data: Uint8Array)` — fans binary Yjs deltas to all other clients in the room (skips sender, skips non-OPEN sockets)
- `broadcastJsonToRoom(roomId, senderId, payload)` — same but for JSON control messages (awareness relay)
- `getRoomDoc(roomId)` — returns the room's `Y.Doc` (used by RBAC in F9)
- `updateClientSeq(roomId, clientId, seq)` — updates stored lastSeq per client
- `roomSize(roomId)` — returns current connection count (for logging)

---

### `server/src/ydoc-store.ts`
Server-side Y.Doc lifecycle and the hot-path update handler.

- `hydrateDocFromDB(roomId)` — on cold start (server restart or first-ever connection),
  replays all `yjs_update` events from Postgres into the in-memory `Y.Doc`.
  Idempotent: skips if doc already has `_hydrated` flag set.
- `applyAndBroadcast(roomId, senderId, actorId, update)` — the hot path for every incoming Yjs mutation:
  1. `Y.applyUpdate(serverDoc, update)` — apply to authoritative in-memory doc
  2. `persistYjsUpdate(...)` — enqueue to the 200ms write buffer → Postgres
  3. `broadcastToRoom(...)` — fan raw binary delta to all other room members
  - Wraps apply in try/catch; corrupt updates are dropped without broadcast
- `persistYjsUpdate(roomId, actorId, update)` — base64-encodes the binary update and calls `appendEvent`
- `encodeRoomState(roomId)` — returns `Y.encodeStateAsUpdate(doc)` (full state blob)
- `encodeRoomStateVector(roomId)` — returns `Y.encodeStateVector(doc)` (for diffs)

---

### `server/src/sync.ts`
Handles the two-phase sync protocol: initial full-state delivery and reconnect diff-replay.

- `sendFullState(ws, roomId)` — called on first connect:
  - Frame 1 (JSON text): `{ type: 'init', seq: <latestSeq> }` — tells client where the log is at
  - Frame 2 (binary): `Y.encodeStateAsUpdate(serverDoc)` — full Yjs state blob
- `replayMissedEvents(ws, roomId, { lastSeq, stateVector })` — called on reconnect:
  1. Queries `events WHERE seq > lastSeq` from Postgres
  2. Materialises those events into a temp `Y.Doc` seeded with current server state
  3. Diffs: `Y.encodeStateAsUpdate(tempDoc, clientStateVector)` → compact binary blob
  4. Frame 1 (JSON text): `{ type: 'synced', seq: <latestSeq> }`
  5. Frame 2 (binary): the diff (skipped if zero bytes)
  - If no missed events: skips step 2–3, sends only `{ type: 'synced' }`

---

### `server/src/ws.ts`
WebSocket upgrade handler — the entry point for all WS connections.

- Uses `WebSocketServer({ noServer: true })` pattern; wired to Fastify's raw HTTP server via the `upgrade` event (not `@fastify/websocket` routes) so authentication happens **before** the WS handshake completes
- `createUpgradeHandler(wss)` returns the `upgrade` event listener:
  1. Validates URL path matches `/ws/:roomId` via regex
  2. Parses `?token=<session_id>` from query string
  3. DB lookup: validates session token, returns `AuthUser` (same query as `requireAuth` middleware)
  4. DB lookup: checks `memberships` table — rejects with 403 if not a member
  5. Calls `hydrateDocFromDB(roomId)` (no-op if already hydrated)
  6. Completes the upgrade via `wss.handleUpgrade(...)`; assigns a `randomUUID()` as `clientId`
  7. Calls `joinRoom` then `sendFullState` then `handleConnection`
- `handleConnection(ws, roomId, clientId, user)` — per-socket message loop:
  - **Binary frame** → `applyAndBroadcast(roomId, clientId, user.id, update)`
  - **`{ type: 'sync' }`** → `replayMissedEvents(ws, roomId, { lastSeq, stateVector })`
  - **`{ type: 'awareness' }`** → `broadcastJsonToRoom(roomId, clientId, { type: 'awareness', data })`
  - `close` / `error` → `leaveRoom(roomId, clientId)`

---

## Server — Modified Files

### `server/src/event-log.ts`
- **Added** `persistYjsUpdate(room_id, actor_id, update: Uint8Array)` export:
  - Base64-encodes the binary Yjs update
  - Calls `appendEvent(..., 'yjs_update', { update: '<base64>' })`
  - Routes through the existing 200ms write buffer — no new DB connections
- No other changes; `appendEvent`, `getEventsSince`, `getLatestSeq` unchanged

### `server/src/index.ts`
- **Added** import of `WebSocketServer` from `ws`
- **Added** import of `createUpgradeHandler` from `./ws.js`
- **Added** `const wss = new WebSocketServer({ noServer: true })` before `listen()`
- **Added** `app.server.on('upgrade', createUpgradeHandler(wss))` after `listen()` resolves
  (must be after `listen()` so `app.server` is populated)

---

## Client — New Files

### `web/lib/yjs.ts`
- Exports singleton `ydoc: Y.Doc` — one instance per browser tab, never recreated
- Exports `nodes = ydoc.getMap<Y.Map<unknown>>('nodes')` — the top-level shared map for all canvas nodes

### `web/store/ws.ts`
Zustand store slice for WebSocket connection state.

- `status: 'connected' | 'reconnecting' | 'offline'` — drives the coloured dot in `ConnectionStatus.tsx` (F14)
- `lastSeq: number` — mirrors the value stored in `localStorage`
- `setStatus(s)` / `setLastSeq(n)` — setters

### `web/lib/ws-provider.ts`
Custom WebSocket provider class with full reconnect and Yjs integration.

- **`WsProvider` class** (state machine: `OFFLINE → CONNECTING → CONNECTED → OFFLINE`):
  - `connect(roomId, token)` — opens the socket, starts message loop and Yjs/awareness listeners
  - `destroy()` — closes socket, cancels timers, destroys awareness
  - `openSocket()` — constructs `new WebSocket(url)` with `binaryType = 'arraybuffer'`; sets up `onopen / onclose / onerror / onmessage`
  - On `onopen`:
    - Sets status to `'connected'`, resets retry counter
    - If previously initialised and `lastSeq > 0`, sends `{ type: 'sync', lastSeq, stateVector }` for reconnect replay; otherwise waits for server to push `init`
  - On `onclose` / `onerror`: sets status to `'reconnecting'`, schedules retry
  - **Outgoing Yjs**: `ydoc.on('update', (update, origin) => if origin !== 'remote' → ws.send(update))` — prevents echo
  - **Outgoing awareness**: encodes with `y-protocols/awareness`, sends as `{ type: 'awareness', data: number[] }`
  - **Incoming binary** (`ArrayBuffer`): `Y.applyUpdate(ydoc, update, 'remote')` — `'remote'` origin prevents re-broadcast
  - **Incoming `{ type: 'init' }`**: stores `seq` as `lastSeq` in localStorage + Zustand; marks `initialised = true`
  - **Incoming `{ type: 'synced' }`**: updates `lastSeq`; sets status to `'connected'`
  - **Incoming `{ type: 'awareness' }`**: decodes with `y-protocols/awareness`
  - **Incoming `{ type: 'rejected' }`**: logs warning (RBAC hook for F9)
- **Exponential backoff**: delays `[1s, 2s, 4s, 8s, 16s, 30s]`, capped at 30s
- **`lastSeq` persistence**: stored in `localStorage` under key `ligma:lastSeq:<roomId>`; survives page refresh
- **Exports**:
  - `wsProvider` — singleton instance
  - `awareness` — shared `Awareness` instance (used by `Cursors.tsx` in F3)
  - `useWsProvider(roomId, token)` — React hook that calls `connect` on mount and `destroy` on unmount

---

## Wire Protocol Summary

```
Client → Server
  [binary]                    Yjs update delta (any mutation)
  { type: 'sync',             Reconnect replay request
    lastSeq: number,
    stateVector: number[] }
  { type: 'awareness',        Cursor / presence update
    data: number[] }

Server → Client
  { type: 'init', seq }       Sent before binary state blob on first connect
  [binary]                    Full Yjs state (first connect) or diff (reconnect)
  { type: 'synced', seq }     Confirms reconnect replay is complete
  { type: 'awareness',        Relayed cursor update from another client
    data: number[] }
  { type: 'rejected',         (F9) Update blocked by RBAC
    reason, nodeId? }
```

---

## Dependency Graph (Server)

```
index.ts
  └── ws.ts
        ├── db.ts               (token + membership queries)
        ├── rooms.ts            (joinRoom, leaveRoom, broadcastToRoom)
        ├── ydoc-store.ts       (hydrateDocFromDB, applyAndBroadcast)
        │     ├── rooms.ts
        │     └── event-log.ts  (appendEvent, getEventsSince)
        │           └── db.ts
        └── sync.ts             (sendFullState, replayMissedEvents)
              ├── ydoc-store.ts
              └── event-log.ts
```

---

## Features Unlocked

| Feature | Status |
|---|---|
| F1 — Bare WebSocket Server | ✅ |
| F2 — Yjs Document Sync | ✅ |
| F7 — Event Log Persistence | ✅ |
| F8 — Reconnection & Replay | ✅ |

**Score impact: +~26 pts** (F8 challenge + F7 architecture points + sync correctness)
