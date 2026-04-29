# LIGMA — Collaborative Intelligence Canvas

> A real-time multiplayer whiteboard that turns your brainstorming session into structured, actionable output — automatically.

---

## What Is It?

LIGMA is a collaborative canvas built for teams that think together. You draw, write sticky notes, and sketch ideas in real time with your teammates. As you work, the system watches what you write and silently does the heavy lifting: classifying tasks, tracking who owes what, and turning the whole session into a document any AI or human can act on.

---

## Features

### Real-Time Collaborative Canvas
Every sticky note, shape, arrow, and freehand stroke is synced instantly across all connected users using **Yjs CRDTs** — the same conflict-resolution technology used in Notion and Linear. Two people can type in the same sticky note simultaneously and their edits merge character-by-character. No locks, no conflicts, no last-write-wins data loss.

### AI-Powered Task Assignment
When you write on a sticky note, the system automatically classifies it using **Groq's Llama 3.1 8B** into one of five intents:

| Badge | Meaning |
|-------|---------|
| `action` | Something that needs to be done |
| `decision` | A conclusion the team reached |
| `question` | An unresolved open question |
| `blocker` | Something blocking progress |
| `reference` | A link, resource, or external reference |

Classification runs server-side (one call regardless of how many users are in the room), is debounced at 800ms, and cached by content hash to avoid redundant API calls. The intent badge appears directly on the sticky note — no manual tagging needed.

### Live Task Board
Every sticky classified as an `action` item surfaces automatically in the **Task Board** panel. Each card shows the text, the author, and a jump button that smoothly pans the canvas to that note. Team members use this as their personal task list — if your name is on it, it's your task.

### Session Replay / Timeline Tracker
Missed part of the session? The system records every canvas mutation as an append-only event log in Postgres. When you reconnect, the canvas **animates** through everything you missed — sticky notes appearing, moving, and being edited in sequence — so you can follow the evolution of ideas rather than just seeing the final state. No context lost.

### AI Document Summary Export
When the brainstorm is done, click **Export** to generate a PDF in two modes:

- **Narrative** — a 3–5 paragraph prose brief written by AI, suitable for sharing with stakeholders who weren't in the session.
- **Structured Sections** — AI-organized output under `Decisions`, `Action Items`, `Open Questions`, and `References`, with each item attributed to the author by name. Ready to paste directly into any coding agent or LLM as a project brief to kick off development.

The PDF includes a full-canvas screenshot on page 1 and the AI summary on page 2.

### Presence Heatmap
As users interact with the canvas, the system tracks activity density across the board. Areas where the team clusters, edits, and returns repeatedly are highlighted — giving latecomers and observers an immediate visual signal of where the important work is. Low-activity areas fade into the background.

### Live Cursor Presence
Every connected user's cursor is visible in real time with their name and colour. You always know who is looking at what.

### Node-Level RBAC
Rooms have three roles: **Lead**, **Contributor**, and **Viewer**. Leads can lock individual nodes so contributors and viewers cannot edit them. Enforcement is **server-side** — even a raw WebSocket client sending a forged Yjs update to a locked node is rejected before it touches the authoritative document.

---

## Architecture

### System overview

```
┌─────────────────────────────────────┐
│           Browser (Next.js)         │
│                                     │
│  Konva Canvas ←→ Yjs Y.Doc          │
│       ↕ binary Yjs updates          │
│  WsProvider (reconnect + replay)    │
└──────────────┬──────────────────────┘
               │  WebSocket /ws/:roomId?token=…
               │  HTTP     /rooms  /auth  /export
               ▼
┌─────────────────────────────────────┐
│        Server (Fastify + ws)        │
│                                     │
│  RBAC validator → Y.Doc per room    │
│  Intent watcher → Groq classifier   │
│  Export route  → Groq summarizer    │
│  Event log     → write buffer 200ms │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│              Postgres               │
│                                     │
│  events      — append-only log      │
│  rooms       — room metadata        │
│  users       — email/password auth  │
│  memberships — per-room roles       │
│  sessions    — bearer tokens        │
│  invites     — invite links         │
└─────────────────────────────────────┘
```

**Why Yjs + event log?**  
Yjs gives **one convergent document** while everyone edits: all clients and the server apply the same ordered updates and end up in the same state. Postgres stores **append-only `yjs_update` events** so a cold server or a late client can **replay** history (including the animated “what you missed” experience).

---

### Canvas architecture (rendering + data)

| Piece | Role |
|-------|------|
| **Konva** (`konva` + `react-konva`) | 2D scene: `Stage` / `Layer`, transforms (pan/zoom), hit-testing, `Transformer` for resize. |
| **`Canvas.tsx`** | Wires tools (select, shapes, pen, erase), stage drag, minimap, heatmap, templates; mounts `ShapeRenderer` per node. |
| **`ShapeRenderer` + `EditableText`** | Draws each node (sticky, rect, pen, …). Text stickies use Konva for display; live editing uses an HTML textarea **bound to Yjs** (see below). |
| **`useYjsNodes`** | Subscribes with `nodes.observeDeep` on the shared `Y.Map`, rebuilds sorted **snapshots** → React re-renders Konva when any node property changes. |
| **Yjs `Y.Doc`** (`web/lib/yjs.ts`) | Single tab-wide document. Top-level `nodes` is `Y.Map<nodeId, Y.Map>` — one nested `Y.Map` per canvas object. |
| **`web/lib/nodes.ts`** | All mutations go through helpers (`createNode`, `updateNode`, …) inside **`ydoc.transact`** where needed; **sticky/text body is `Y.Text`**, not a plain string. |

**Data shape (conceptually):**

- `ydoc.getMap('nodes')` → `{ [nodeId]: Y.Map }`
- Each node `Y.Map` holds primitives (`x`, `y`, `width`, `height`, `type`, `z_index`, …) and **`content` as `Y.Text`** for stickies/text nodes so typing is a CRDT.

**Client boot:** `Canvas` is **`dynamic(..., { ssr: false })`** because Konva needs `window`.

**Realtime transport:** `WsProvider` opens `WebSocket` `/ws/<roomId>?token=…`. **Binary frames** are Yjs updates (`Y.applyUpdate` with origin `'remote'`). **JSON frames** handle protocol (`init` / `sync` / replay) and **awareness** (cursors) via `y-protocols/awareness`, separate from the CRDT payload.

---

### Server-side canvas pipeline

1. **Upgrade** (`server/src/ws.ts`): validate session + room membership before `handleUpgrade`.
2. **Binary message** → `applyAndBroadcast` (`server/src/ydoc-store.ts`):
   - **`validateUpdate`** (`rbac.ts`) — drop forbidden changes (e.g. locked node) **before** applying; optionally notify sender with a `rejected` frame.
   - **`Y.applyUpdate(serverDoc, update)`** — authoritative in-memory room doc.
   - **`persistYjsUpdate`** — base64 event appended to Postgres (batched ~200ms).
   - **`broadcastToRoom`** — same delta to every other socket in the room.
3. **Hydration** — first connection for a room replays `yjs_update` rows from DB into the server `Y.Doc`.
4. **Reconnect** (`sync.ts`) — client sends `lastSeq` / state vector; server sends a **diff** so clients catch up without full reload.

---

### Collaboration vs conflicts

There is **no custom merge UI** and **no ad-hoc “locks” for collaboration** (except **ACL locks** for permissioning). Sync semantics come **entirely from Yjs**.

**Two people edit the same sticky note (text)**  
Body is **`Y.Text`**. Yjs uses a **text CRDT**: concurrent insertions and deletes are merged so that **both users’ edits are incorporated** in a well-defined causal order (character-level merge). You do *not* get “last save wins” wiping the other person’s paragraph; both streams are composed. In practice, edits usually look like **interleaved or merged text**, not silent loss.

**Two people change the same property (e.g. drag the same note to two places)**  
Geometry and most metadata live as **primitive values on the node `Y.Map`** (`x`, `y`, `width`, …). For those, Yjs resolves concurrent writes with **last-writer-wins (LWW)** using its internal logical clocks: one position “wins” on the converged doc — **not** two conflicting copies of the node. Same idea for other scalar fields (e.g. one user changes fill while another moves: different keys → both can survive; **same key** from two peers → LWW).

**Deletes vs edits**  
Deleting the node removes the key from the top-level `nodes` map; concurrent ops are still ordered by the CRDT so everyone converges to the same tombstone/state.

**Permission conflicts**  
If a node is **locked** (lead-only ACL), the server **rejects** the update **before** apply — the forbidden change never enters the shared doc (see `applyAndBroadcast` + RBAC).

---

### Why Yjs + Event Log? (short)

- **Yjs** = runtime convergence for editing (text + structure).  
- **Event log** = durability + replay for reconnects, server cold start, and timeline UX.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 15 (App Router) + TypeScript |
| Canvas | Konva.js + react-konva |
| Real-time sync | Yjs (CRDT) over custom WebSocket |
| Styling | Tailwind CSS |
| Client state | Zustand |
| Backend | Node.js + Fastify |
| Database | Postgres |
| AI classification | Groq API — Llama 3.1 8B Instant |
| AI summarisation | Groq API — Llama 3.1 8B Instant |
| PDF generation | PDFKit |
| Deployment | Railway |

---

## Setup & Running Locally

### Prerequisites

- Node.js 20+
- A Postgres database (Railway, Supabase, or local `psql`)
- A [Groq API key](https://console.groq.com) — free, no credit card required

---

### 1. Clone the repo

```bash
git clone https://github.com/your-org/ligma.git
cd ligma
```

---

### 2. Set up the backend

```bash
cd server
npm install
```

Create `server/.env`:

```env
DATABASE_URL=postgres://user:password@host:5432/dbname
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
PORT=3001
```

Run migrations in order:

```bash
psql $DATABASE_URL -f migrations/001_init.sql
psql $DATABASE_URL -f migrations/002_canvas_nodes.sql
psql $DATABASE_URL -f migrations/003_auth.sql
```

Start the dev server:

```bash
npm run dev
```

Backend runs at `http://localhost:3001`.

---

### 3. Set up the frontend

```bash
cd web
npm install
```

Create `web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

Start the dev server:

```bash
npm run dev
```

Frontend runs at `http://localhost:3000`.

---

### 4. First use

1. Open `http://localhost:3000` and register an account
2. Create a room — you become the Lead automatically
3. Copy the invite link and share it with teammates
4. Start brainstorming

---

## Deploying to Railway

1. Push the repo to GitHub
2. Create a Railway project → add two services pointing to `/web` and `/server`
3. Add a **Postgres** plugin to the project
4. Set environment variables in the Railway dashboard (same keys as `.env` above; set `NEXT_PUBLIC_API_URL` to the deployed server URL)
5. Deploy — Railway auto-detects Node.js and runs `npm run build` + `npm run start`

---

## Trade-offs

| Decision | Why |
|----------|-----|
| Yjs only, no OT fallback | Yjs is battle-tested in production. Adding OT adds complexity without a realistic failure scenario to justify it. |
| 200ms write buffer | Batching Postgres writes trades a tiny crash-loss window for dramatically lower DB load on free-tier connections. |
| AI intent is eventually consistent | Classifying on every keystroke would exhaust the free-tier rate limit in minutes. 800ms debounce is imperceptible in practice. |
| Single-server WebSocket | Horizontal scaling needs Redis pub/sub. Out of scope for a 48-hour build; one Railway instance handles demo traffic comfortably. |
