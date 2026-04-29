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

**Why Yjs + Event Log?**
Yjs solves runtime convergence — concurrent edits automatically merge without coordination. The Postgres event log solves durable history — every update is persisted in causal order so the system can reconstruct any past state and replay it to late-joining clients.

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
