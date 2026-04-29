# LIGMA — Live Interactive Group Meeting App

> Real-time collaborative canvas with AI-powered note classification, structured export, and role-based access control.
> Built for hackathon by **Team Raptors**.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Database Schema](#database-schema)
5. [API Reference](#api-reference)
6. [WebSocket Protocol](#websocket-protocol)
7. [AI Features](#ai-features)
8. [RBAC](#rbac)
9. [Environment Variables](#environment-variables)
10. [Running Locally](#running-locally)
11. [Deployment (Render)](#deployment-render)
12. [License](#license)

---

## Overview

LIGMA is a multi-user collaborative whiteboard designed for meeting teams. Participants join a named **room**, drop sticky notes and drawings onto a shared canvas, and get an AI-generated PDF summary at the end — either a prose narrative or a structured brief (Decisions / Action Items / Open Questions / References).

Key capabilities:

- **Real-time sync** — sub-50 ms delta propagation via Yjs CRDTs over WebSocket
- **Offline resilience** — client stores last-seen sequence number; on reconnect the server replays only missed deltas with a smooth animated catch-up
- **AI intent classification** — every sticky note is automatically labelled `decision | action_item | open_question | blocker | reference | none` by Groq's `llama-3.1-8b-instant`
- **PDF export** — canvas screenshot + Groq-generated summary merged into a branded PDF via PDFKit
- **Email notifications** — invite emails via EmailJS
- **Role-based access control** — `lead | contributor | viewer`; every incoming WebSocket delta is validated server-side against a cloned doc before being applied

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Konva / react-konva, Zustand, Yjs |
| Backend | Fastify (Node.js), TypeScript, `ws` (WebSocket), Yjs |
| Database | PostgreSQL (via `pg`) |
| AI | Groq API — `llama-3.1-8b-instant` |
| PDF | PDFKit |
| Email | EmailJS REST API |
| Deployment | Render (server + DB) + Vercel or Render (web) |

---

## Architecture

```
┌─────────────────────────────────────────┐
│              Browser (Next.js)           │
│                                          │
│  Konva Canvas  ↔  Yjs Y.Doc             │
│       ↕  binary Yjs updates             │
│  WsProvider (reconnect + replay)         │
└──────────────────┬──────────────────────┘
                   │
        WebSocket  /ws/:roomId?token=…
        HTTP       /rooms  /auth  /export
                   │
                   ▼
┌─────────────────────────────────────────┐
│           Server (Fastify + ws)          │
│                                          │
│  RBAC validator  →  Y.Doc per room      │
│  Intent watcher  →  Groq classifier     │
│  Export route    →  Groq summarizer     │
│  Event log       →  write buffer 200ms  │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│                Postgres                  │
│                                          │
│  events      — append-only log          │
│  rooms       — room metadata            │
│  users       — email/password auth      │
│  memberships — per-room roles           │
│  sessions    — bearer tokens            │
│  invites     — invite links             │
└─────────────────────────────────────────┘
```

### CRDT — Why Yjs

LIGMA uses **Yjs** (YATA algorithm). Unlike Operational Transformation, CRDTs need no central serialization — every client merges updates deterministically. The server acts as a **relay and persistent store**, not an arbiter of order.

- Canvas nodes → `Y.Map` keyed by node ID inside the root `nodes` map
- Text content → `Y.Text` (sequence CRDT, handles concurrent character inserts)
- Geometry fields (x, y, w, h) → plain values, last-write-wins via Yjs lamport timestamp

### Event Sourcing

Every mutation is stored as a `yjs_update` row (base64 binary delta in `payload.update`) in an append-only `events` table with a `BIGSERIAL seq`. On server restart, `hydrateDocFromDB()` replays all rows in seq order to reconstruct exact Y.Doc state. A **200 ms write buffer** batches rapid keystrokes into a single `INSERT`.

### WebSocket Delta Protocol

```
Client                          Server
  |── HTTP Upgrade ────────────▶|  token + membership validated
  |◀─ 101 Switching ────────────|
  |◀─ { type:'init', seq } ─────|  current head seq
  |◀─ binary (full state) ──────|  Y.encodeStateAsUpdate(doc)
  |── binary (state vector) ───▶|  client pushes its state vec
  |◀─ { type:'synced' } ────────|

  [on reconnect after gap]
  |── ?lastSeq=N ───────────────▶|
  |◀─ { type:'replay', … } ──────|  base state + missed deltas (animated)
```

Reconnection uses exponential backoff `[1s, 2s, 4s, 8s, 16s, 30s]`. The client persists `ligma:lastSeq:<roomId>` in `localStorage`; the server computes the minimal diff via `Y.encodeStateVectorFromUpdate` / `Y.diffUpdate`.

### RBAC Enforcement

`validateUpdate(roomDoc, incomingUpdate, role)` in `rbac.ts`:

1. **Fast-path** — viewers rejected immediately, no clone needed
2. **Clone** — applies update to a copy of the authoritative doc
3. **ACL diff** — rejects if update would grant/revoke permissions the actor doesn't own
4. **Locked nodes** — only `lead` may modify `is_locked = true` nodes
5. **Create/delete** — `viewer` role is always rejected

If rejected → `{ type: 'rejected', reason, nodeId? }` sent only to the offending client; authoritative doc is never touched.

---

## Database Schema

```sql
-- Core identity
users        (id UUID PK, name, email UNIQUE, password_hash, created_at)
sessions     (id UUID PK, user_id FK, expires_at, created_at)

-- Rooms
rooms        (id UUID PK, name, created_by FK, created_at)
memberships  (id UUID PK, room_id FK, user_id FK, role, joined_at)
             UNIQUE (room_id, user_id)
invites      (id UUID PK, room_id FK, email, role, token UUID UNIQUE,
              invited_by FK, expires_at, accepted_at)

-- Event log (append-only)
events       (id UUID PK, room_id FK, seq BIGSERIAL, actor,
              type, payload JSONB, created_at)

-- Read receipts
user_room_reads (user_id FK, room_id FK, last_seen_seq, last_seen_at)
                PRIMARY KEY (user_id, room_id)

-- Canvas geometry (denormalized cache — authoritative state is in Y.Doc)
canvas_nodes (id UUID PK, room_id FK,
              x, y, width, height NUMERIC,
              type CHECK(sticky|text|rect|circle|pen),
              content TEXT,
              intent CHECK(decision|action_item|open_question|blocker|reference|none),
              author_id FK, acl JSONB DEFAULT '{}',
              is_locked BOOLEAN DEFAULT false,
              deleted_at TIMESTAMPTZ,
              created_at, updated_at)
```

---

## API Reference

All endpoints require `Authorization: Bearer <session_token>` unless noted.

### Auth

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | `{name, email, password}` | Create account |
| POST | `/auth/login` | `{email, password}` | Returns `{token, user}` |
| POST | `/auth/logout` | — | Invalidates session |
| GET | `/auth/me` | — | Returns current user |

### Rooms

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rooms` | List rooms the user is a member of |
| POST | `/rooms` | Create a new room |
| GET | `/rooms/:id` | Room metadata + membership list |
| DELETE | `/rooms/:id` | Delete room (lead only) |

### Invites

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/rooms/:id/invite` | `{email, role}` | Send invite email + create invite record |
| GET | `/invite/:token` | — | Resolve token → room info (no auth required) |
| POST | `/invite/:token/accept` | — | Accept invite, add membership |

### Export

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/rooms/:id/export` | `{mode, image}` | Generate PDF summary; `mode` is `narrative` or `structured`; `image` is raw base64 PNG (no data-URL prefix); returns `application/pdf` |

Body limit: 12 MB.

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/rooms` | Per-room missed-update counts and member stats |
| GET | `/dashboard/user` | Aggregated personal summary: total rooms, missed updates |

---

## WebSocket Protocol

Connect to `ws://<host>/rooms/<roomId>/ws?token=<sessionToken>&lastSeq=<N>`.

### Server → Client message types

| Type | Format | Meaning |
|------|--------|---------|
| `init` | `{type, seq}` | Handshake; seq is current head |
| binary | `Uint8Array` | Full Y.Doc state (immediately after init) |
| `synced` | `{type}` | Client and server are in sync |
| `replay` | `{type, baseState?, updates[], finalSeq}` | Missed-delta catch-up |
| `awareness` | `{type, awareness}` | Cursor / presence broadcast |
| `rejected` | `{type, reason, nodeId?}` | Update rejected by RBAC |

### Client → Server message types

| Format | Meaning |
|--------|---------|
| binary `Uint8Array` | Yjs delta update |
| `{type:'awareness', awareness}` | Cursor position / user colour |
| `{type:'sync', stateVector}` | State vector for diff calculation |

---

## AI Features

### Intent Classification

`server/src/classifier.ts` — called 800 ms after the user stops typing (debounced in `intent-watcher.ts`).

Model: `llama-3.1-8b-instant` at temperature 0.  
Cache: SHA-256 of the input text → label, stored in-process.

Labels and their meaning:

| Label | Meaning |
|-------|---------|
| `decision` | Something the group resolved |
| `action_item` | A task that needs to be done |
| `open_question` | An unresolved question |
| `blocker` | An impediment |
| `reference` | A link, doc, or reference material |
| `none` | General note |

### PDF Export

`POST /rooms/:id/export` takes a canvas screenshot (base64 PNG) and builds a PDF containing:

1. Room name, date, member list
2. Canvas screenshot (scaled to fit)
3. AI-generated summary (narrative prose or structured sections)

The structured mode uses explicit section headers (Decisions / Action Items / Open Questions / References) extracted from intent-labelled notes.

---

## RBAC

| Action | viewer | contributor | lead |
|--------|--------|-------------|------|
| Read canvas | yes | yes | yes |
| Create node | no | yes | yes |
| Edit own node | no | yes | yes |
| Edit any node | no | no | yes |
| Delete node | no | yes (own) | yes |
| Lock/unlock node | no | no | yes |
| Invite members | no | no | yes |
| Export PDF | yes | yes | yes |
| Delete room | no | no | yes |

---

## Environment Variables

### Server (`server/.env`)

```env
DATABASE_URL=postgres://user:password@host:5432/dbname
GROQ_API_KEY=gsk_...
PORT=3001
ALLOWED_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# EmailJS
EMAILJS_SERVICE_ID=service_...
EMAILJS_TEMPLATE_ID=template_...
EMAILJS_TASK_TEMPLATE_ID=template_...   # falls back to EMAILJS_TEMPLATE_ID
EMAILJS_PUBLIC_KEY=...
EMAILJS_PRIVATE_KEY=...
```

### Web (`web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001   # optional; derived from API_URL if omitted
```

---

## Running Locally

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### 1. Database

```bash
createdb ligma
psql ligma < server/migrations/001_init.sql
psql ligma < server/migrations/002_canvas_nodes.sql
psql ligma < server/migrations/003_auth.sql
```

### 2. Server

```bash
cd server
cp .env.example .env    # fill in DATABASE_URL and GROQ_API_KEY
npm install
npm run dev             # nodemon + ts-node, port 3001
```

### 3. Web

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev             # Next.js dev server, port 3000
```

Open `http://localhost:3000`, register an account, create a room, and open it in two browser tabs to test real-time sync.

---

## Deployment (Render)

### Server (Web Service)

| Setting | Value |
|---------|-------|
| Environment | Node |
| Build command | `cd server && npm install && npm run build` |
| Start command | `cd server && npm start` |
| Health check path | `/health` |

Add all env vars from the [Server section above](#server-serverenv).  
Set `ALLOWED_ORIGIN` to your web app's public URL.

### Database (PostgreSQL)

Create a **Render PostgreSQL** instance. Copy the **Internal Database URL** into `DATABASE_URL` on the server service. Run migrations via the Render Shell tab:

```bash
psql $DATABASE_URL < migrations/001_init.sql
psql $DATABASE_URL < migrations/002_canvas_nodes.sql
psql $DATABASE_URL < migrations/003_auth.sql
```

### Web (Static Site or Web Service)

Deploy `web/` as a **Next.js** app on Vercel or as a Render Web Service:

| Setting | Value |
|---------|-------|
| Build command | `cd web && npm install && npm run build` |
| Start command | `cd web && npm start` |

Set `NEXT_PUBLIC_API_URL` to the Render server's public URL (e.g. `https://ligma-server.onrender.com`).

### WebSocket on Render

Render supports WebSockets on standard Web Services with no additional configuration. Ensure your server's Fastify instance listens on `0.0.0.0` (the default) and that `PORT` is set from `process.env.PORT` (Render injects this automatically).

---

## File Tree

```
LIGMA/
├── server/
│   ├── migrations/
│   │   ├── 001_init.sql
│   │   ├── 002_canvas_nodes.sql
│   │   └── 003_auth.sql
│   └── src/
│       ├── index.ts          # Fastify entry, WSS setup
│       ├── ws.ts             # WebSocket upgrade handler
│       ├── ydoc-store.ts     # Hydration, applyAndBroadcast
│       ├── sync.ts           # sendFullState, replayMissedEvents
│       ├── rbac.ts           # Server-side update validation
│       ├── rooms.ts          # In-memory room registry
│       ├── event-log.ts      # Append events, 200ms batch buffer
│       ├── intent-watcher.ts # observeDeep + debounce classify
│       ├── classifier.ts     # Groq intent classify
│       ├── mailer.ts         # EmailJS wrappers
│       ├── export-pdf.ts     # PDFKit builder
│       ├── db.ts             # pg pool
│       └── routes/
│           ├── auth.ts
│           ├── rooms.ts
│           ├── invites.ts
│           ├── export.ts
│           └── dashboard.ts
└── web/
    ├── app/                  # Next.js App Router pages
    ├── components/           # Canvas, toolbar, sidebar UI
    └── lib/
        ├── ws-provider.ts    # WsProvider class
        ├── node-types.ts     # NodeSnapshot, NodeKind, Role
        └── store.ts          # Zustand canvas store
```

---

## License

MIT
