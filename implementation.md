# LIGMA — Implementation Plan

> A feature-by-feature build guide for the DevDay '26 Hackathon.
> Read this top to bottom. Do not skip features. Each one builds on the last.

---

## Project Overview

**What you're building:** A real-time collaborative canvas (like Miro) that auto-extracts action items from sticky notes into a live Task Board.

**Target score:** 85–95 / 100

**Time:** 48 hours, 3 people

**The golden rule:** Ship features in order. A working partial system beats a half-built complete one.

---

## Tech Stack (Final, Locked In)

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js 14 (App Router) + TypeScript | Fast scaffold, deploys to Render in one click |
| Canvas | Konva.js + react-konva | Battle-tested, handles transforms/zoom |
| Styling | Tailwind CSS | Speed, no design bikeshedding |
| Local UI state | Zustand | Tiny, no boilerplate |
| Real-time sync | **Yjs** | Solves CRDT conflict resolution for free |
| WebSocket transport | Custom server using `ws` library | Need to intercept for RBAC |
| Backend | Node.js + Fastify | Same process serves HTTP + WS |
| Database | Postgres (Render free tier) | Append-only event log lives here |
| AI classifier | Groq API (free tier, Llama 3.1 8B) | Sub-second, no credit card |
| Deployment | Render | Required by hackathon rules |

**DO NOT USE:** Liveblocks, Pusher, Ably, Supabase Realtime, Firebase. These are 3rd-party paid integrations and will get you disqualified.

---

## Project Setup (Hours 0–1)

### Step 1: Create the repo structure

```
ligma/
├── web/              # Next.js frontend
├── server/           # Node.js backend (Fastify + ws)
├── shared/           # Shared TypeScript types
├── README.md         # The judge-facing README (write this LATER)
└── implementation.md # This file
```

### Step 2: Initialize frontend

```bash
cd web
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir
npm install yjs konva react-konva zustand
npm install -D @types/node
```

### Step 3: Initialize backend

```bash
cd server
npm init -y
npm install fastify ws yjs pg dotenv
npm install -D typescript @types/node @types/ws @types/pg ts-node nodemon
npx tsc --init
```

### Step 4: Set up Postgres on Render

1. Create a Render account
2. Create a new Postgres instance (free tier)
3. Copy the `External Database URL` into `server/.env` as `DATABASE_URL`
4. Connect locally with `psql $DATABASE_URL` to confirm

### Step 5: Initial schema migration

Create `server/migrations/001_init.sql`:

```sql
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id),
  user_id UUID REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('lead', 'contributor', 'viewer')),
  UNIQUE(room_id, user_id)
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id),
  actor_id UUID REFERENCES users(id),
  seq BIGSERIAL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_room_seq ON events(room_id, seq);
```

Run it: `psql $DATABASE_URL -f server/migrations/001_init.sql`

### Step 6: Deploy empty app to Render

Push the empty repo to GitHub, connect Render, deploy both the web service and Postgres. **Confirm the deploy works before writing any real code.** This is the single most important de-risking step in the whole hackathon.

---

## Feature Order (Build in This Sequence)

The features below are ordered by dependency. Don't skip ahead. Each feature has a "Done When" checkbox — only move on when it's met.

---

## Feature 1: Bare WebSocket Server (Hours 1–3)

**What:** A WebSocket endpoint at `/ws/:roomId` that any client can connect to and broadcast messages.

**Libraries:** `ws`, `fastify`

**Implementation:**

1. Create `server/src/index.ts` with Fastify on port 3001
2. Attach a `WebSocketServer` from the `ws` package on the same HTTP server
3. Maintain `Map<roomId, Set<WebSocket>>` to track connections per room
4. On message received → broadcast to all other sockets in the same room

**Files:**
- `server/src/index.ts` — server bootstrap
- `server/src/ws.ts` — WebSocket connection handler
- `server/src/rooms.ts` — in-memory room registry

**Done when:** Two `wscat` clients connected to the same room can echo messages to each other.

---

## Feature 2: Yjs Document Sync (Hours 3–6)

**What:** Replace raw message broadcasting with Yjs binary update sync.

**Libraries:** `yjs`

**Implementation:**

1. On the server: keep one `Y.Doc` per active room in memory
2. When a client connects: send the current Yjs state via `Y.encodeStateAsUpdate(doc)`
3. When a client sends a Yjs update (binary `Uint8Array`): apply with `Y.applyUpdate(serverDoc, update)`, then broadcast to all other clients in the room
4. On the client: instantiate a `Y.Doc`, create a `Y.Map` named `nodes` inside it, set up an `update` listener that sends binary updates to the server

**Key code pattern:**
```typescript
// Client side
ydoc.on('update', (update: Uint8Array, origin: any) => {
  if (origin !== 'remote') ws.send(update);
});

// Server side
ws.on('message', (data) => {
  Y.applyUpdate(roomDoc, new Uint8Array(data));
  // broadcast to others
});
```

**Files:**
- `web/lib/yjs.ts` — Y.Doc instance and provider
- `server/src/ydoc-store.ts` — server-side Y.Doc registry

**Done when:** Open two browser tabs, run `ydoc.getMap('nodes').set('test', 'hello')` in Tab A's console, see it appear in Tab B's `ydoc.getMap('nodes').get('test')`.

---

## Feature 3: Cursor Presence (Hours 6–8)

**What:** Each user's mouse cursor is visible to everyone else in the room with their name and color.

**Libraries:** `yjs` (Awareness protocol — built in)

**Implementation:**

1. Import `Awareness` from `yjs/dist/src/utils/Awareness` (or `y-protocols/awareness`)
2. On `mousemove` (throttled to ~30ms): `awareness.setLocalStateField('cursor', { x, y, name, color })`
3. Subscribe to `awareness.on('change', ...)` to re-render other users' cursors
4. On the server: relay awareness updates between clients (separate message type from doc updates)

**Files:**
- `web/lib/awareness.ts` — awareness instance + helpers
- `web/components/Cursors.tsx` — renders other users' cursors as absolutely-positioned divs

**Done when:** Open two tabs, move mouse in Tab A, see a smoothly-moving labeled cursor in Tab B with under 100ms delay.

**Rubric points unlocked:** Cursor presence (5 pts) ✅

---

## Feature 4: Canvas Foundations (Hours 8–11)

**What:** Pannable, zoomable infinite canvas where you can create sticky notes by double-clicking.

**Libraries:** `konva`, `react-konva`

**Implementation:**

1. Render a `<Stage>` filling the viewport with a draggable `<Layer>`
2. Implement zoom with `wheel` event → adjust stage `scale` and `position`
3. Double-click on empty canvas → create a new node in the Yjs `nodes` map
4. Each node is a `Y.Map` with: `id`, `type`, `x`, `y`, `width`, `height`, `content` (a `Y.Text`), `author_id`, `created_at`, `acl`, `intent`

**Critical detail:** `content` MUST be a `Y.Text`, not a plain string. This is what enables character-by-character merge during simultaneous editing. **Skipping this loses 10 points on Conflict Resolution.**

**Files:**
- `web/components/Canvas.tsx` — main Konva stage
- `web/components/StickyNote.tsx` — individual sticky rendering
- `web/lib/nodes.ts` — `createNode()`, `updateNode()`, `deleteNode()` helpers using Yjs transactions

**Done when:** Double-clicking creates a sticky note that appears in both tabs simultaneously, and dragging it in one tab moves it in the other.

---

## Feature 5: Multi-Element Canvas (Hours 11–14)

**What:** Add text blocks, shapes (rect/circle), and freehand drawing.

**Libraries:** Already installed (`konva`)

**Implementation:**

1. Add a toolbar with mode selector: `select | sticky | text | rect | circle | pen`
2. Sticky/text/shapes: click empty canvas → create node at click position
3. Pen mode: collect points on `mousedown` → `mousemove` → `mouseup`, store as a polyline in node's `content`
4. Selection: clicking a node sets it as selected (in Zustand, NOT in Yjs — selection is local)
5. Drag-to-move: update the node's `x`/`y` in a Yjs transaction on drag end (NOT every frame — that floods the network)

**Files:**
- `web/components/Toolbar.tsx`
- `web/components/Drawing.tsx`
- `web/store/ui.ts` — Zustand store for selected node ID, current tool, etc.

**Done when:** All four element types can be created, moved, and synced across tabs.

---

## Feature 6: Collaborative Text Editing (Hours 14–16)

**What:** Two users typing in the same sticky note simultaneously merge character-by-character.

**Libraries:** `yjs` (the `Y.Text` you already set up)

**Implementation:**

1. When a sticky note is double-clicked, render an editable `<textarea>` overlay
2. Bind the `<textarea>` to the node's `Y.Text` using a manual binding:
   - On Yjs `Y.Text` change: update textarea value
   - On textarea change: compute the diff, apply to `Y.Text` with `ytext.insert()` / `ytext.delete()`
3. OR use the simpler `y-textarea` package if available — but writing the binding yourself is safer (one less dep)

**Files:**
- `web/components/EditableText.tsx`

**Done when:** Two tabs editing the same sticky note simultaneously: Tab A types "hello" at position 0 while Tab B types "world" at position 5 — both tabs end up showing the same merged result.

**Rubric points unlocked:** Conflict Resolution (10 pts) ✅, Multi-user canvas sync (10 pts) ✅

---

## Feature 7: Event Log Persistence (Hours 16–19)

**What:** Every Yjs update is persisted to Postgres with a sequence number, so state can be reconstructed from history.

**Libraries:** `pg`

**Implementation:**

1. On the server: when a Yjs update is received, before broadcasting, insert into `events` table:
   - `room_id`, `actor_id`, `event_type = 'yjs_update'`, `payload = { update: base64(update) }`
   - `seq` auto-increments via `BIGSERIAL`
2. Use a connection pool (`pg.Pool`), NOT new connections per insert — Render's free Postgres has tight connection limits
3. Add an in-memory write buffer that batches inserts every 200ms to avoid hammering the DB

**Files:**
- `server/src/db.ts` — Postgres pool + helpers
- `server/src/event-log.ts` — append/query functions

**Done when:** Make 10 changes, query `SELECT seq, event_type, created_at FROM events WHERE room_id = ? ORDER BY seq` and see all 10 events in order.

**Rubric points unlocked:** Event-sourced architecture (8 pts) ✅

---

## Feature 8: Reconnection & Replay (Hours 19–22)

**What:** When a client reconnects after a disconnect, it receives only the events it missed — not the full state.

**Libraries:** `yjs`

**Implementation:**

1. Client tracks the last `seq` it received in localStorage
2. On WebSocket reconnect, client sends `{ type: 'sync', lastSeq: 42, stateVector: <bytes> }`
3. Server queries `events WHERE room_id = ? AND seq > 42`, applies them to a temp Y.Doc, then sends `Y.encodeStateAsUpdate(tempDoc, clientStateVector)` — this is the **diff** the client is missing
4. Client applies the diff with `Y.applyUpdate()`
5. Add reconnection logic with exponential backoff: 1s, 2s, 4s, 8s, max 30s

**Files:**
- `web/lib/ws-provider.ts` — custom WebSocket provider with reconnect
- `server/src/sync.ts` — handles initial sync and replay

**Done when:** Open Tab A, make 5 changes, kill the server, restart it, watch Tab A automatically reconnect and re-sync without page refresh.

**Rubric points unlocked:** Real-Time WebSocket Management (Challenge 5) ✅

---

## Feature 9: Node-Level RBAC (Hours 22–28) ⚠️ HIGH STAKES

**What:** Per-node permissions. A "Lead" can lock a node so contributors and viewers can't edit it. Enforced server-side.

**Libraries:** `yjs`

**Implementation:**

1. **Data model:** Each node's `acl` field is a `Y.Map` like `{ lead: ['*'], contributor: ['view', 'comment'], viewer: ['view'] }`
2. **UI side (client):** Show a lock icon on selected nodes; clicking shows a role/permission editor (only visible to leads). Read-only nodes get a different cursor and disabled inputs.
3. **Server-side enforcement (THE CRITICAL PART):**
   - When a Yjs update arrives, decode it into a temporary `Y.Doc`
   - Diff against the current room doc to identify which node IDs were mutated
   - For each mutated node: check the actor's role and the node's ACL
   - If unauthorized: REJECT the update, send an error message back, do NOT broadcast
4. **Client-side rejection handling:** On receiving a rejection, revert the local optimistic update by re-applying the server's authoritative state for that node

**Why this is hard:** Yjs updates are binary blobs. You can't trivially "see" what changed. The pattern is:

```typescript
// Pseudo-code
const tempDoc = new Y.Doc();
Y.applyUpdate(tempDoc, currentServerState);
Y.applyUpdate(tempDoc, incomingUpdate);
// Compare tempDoc.nodes vs serverDoc.nodes to find changed node IDs
// Validate each change against ACLs
// If all pass: apply to real doc + broadcast
// If any fail: send rejection
```

**Files:**
- `server/src/rbac.ts` — validation logic
- `server/src/yjs-diff.ts` — node-level diffing
- `web/components/AclEditor.tsx`

**Test (mandatory before moving on):** Open `wscat`, connect as a viewer, send a raw Yjs update trying to modify a locked node. The server MUST reject it. If it doesn't, you score zero on this category.

**Rubric points unlocked:** Node-level RBAC (7 pts) ✅

---

## Feature 10: AI Intent Classification (Hours 28–31)

**What:** When a user writes on a sticky note, an AI classifies it as `action_item`, `decision`, `open_question`, `reference`, or `none`. Result is stored on the node.

**Libraries:** `node-fetch` (or built-in `fetch` on Node 18+)

**Implementation:**

1. Sign up at console.groq.com (free, no credit card) → get API key → `GROQ_API_KEY` in `.env`
2. **Regex fallback first** (runs locally, instant):
   - Starts with imperative verb or "TODO" → `action_item`
   - Ends with `?` → `open_question`
   - Contains "decided" / "we'll go with" / "agreed" → `decision`
   - Contains URL or "[ref]" → `reference`
3. **Groq fallback** (only if regex returns `none`):
   - Endpoint: `POST https://api.groq.com/openai/v1/chat/completions`
   - Model: `llama-3.1-8b-instant`
   - Prompt: tight system prompt that returns ONLY the category name
4. **Caching:** SHA-256 the text, store result in an in-memory Map. Skip the API call if hash unchanged.
5. **Debouncing:** When a node's `content` changes, wait 800ms of silence before classifying. Cancel pending classification on new edits.
6. **Where to run it:** Server-side. The server watches its own Y.Doc for `content` changes, classifies, then writes the `intent` field back. This way, 5 users editing means 1 classification call, not 5.

**Files:**
- `server/src/classifier.ts` — regex + Groq logic
- `server/src/intent-watcher.ts` — debounced Y.Doc observer

**Done when:** Type "TODO: deploy by Friday" into a sticky → within 3 seconds, the node's `intent` field becomes `action_item`.

**Rubric points unlocked:** AI Intent Extraction (10 pts) ✅

---

## Feature 11: Live Task Board (Hours 31–34)

**What:** A right-side drawer showing all nodes where `intent === 'action_item'`, with author, timestamp, and a "jump to node" button.

**Libraries:** Already installed

**Implementation:**

1. Subscribe to changes on the Yjs `nodes` map
2. Filter: `nodes.values().filter(n => n.intent === 'action_item')`
3. Render each as a card showing: text snippet (first 80 chars), author name + avatar, "X mins ago", jump button
4. **Jump animation:** clicking jump → smoothly tween the Konva stage's `position` to center the target node, then briefly highlight the node with a glow animation

**Files:**
- `web/components/TaskBoard.tsx`
- `web/lib/canvas-controls.ts` — `panTo(x, y)` with smooth animation

**Done when:** Task Board updates in real time across all tabs as action items are typed; jump button smoothly pans to the node.

**Rubric points unlocked:** Task Board integration (8 pts) ✅

---

## Feature 12: Append-Only Event Log Sidebar (Hours 34–35)

**What:** A collapsible sidebar showing the chronological list of every mutation in the room.

**Libraries:** Already installed

**Implementation:**

1. Server endpoint `GET /rooms/:id/events?after=<seq>&limit=100` returning event rows
2. On client mount, fetch the latest 100 events
3. Subscribe to new events via WebSocket (server pushes a lightweight notification on each insert)
4. Render as a scrollable list: `[timestamp] [actor] [event_type] [summary]`
5. Make summaries human-readable: instead of "yjs_update", show "Created sticky note", "Moved node", "Edited text", etc. (Derive from the Yjs diff you already do for RBAC.)

**Files:**
- `web/components/EventLog.tsx`
- `server/src/routes/events.ts`

**Done when:** Every action you take appears in the sidebar in real time with a meaningful description.

---

## Feature 13: Time-Travel Replay (Bonus) (Hours 35–40)

**What:** A scrubbable timeline. Drag the slider to see the canvas state at any point in the session.

**Libraries:** Already installed

**Implementation:**

1. Add a horizontal slider at the bottom of the canvas
2. Slider range: `0` to `latestSeq`
3. On drag: fetch events `seq <= scrubbedSeq` (paginated, cached client-side)
4. Materialize a read-only `Y.Doc` by applying all those events
5. While in replay mode:
   - Dim the live canvas
   - Render the read-only doc as a "ghost" layer
   - Disable all editing
6. "Exit replay" button snaps back to live state

**Performance trick:** Cache events in chunks of 100. Don't fetch on every pixel of slider drag — debounce 50ms.

**HARD CUTOFF: If this isn't working by hour 40, abandon it and use the time for polish.** A broken bonus feature scores zero.

**Files:**
- `web/components/Timeline.tsx`
- `web/lib/replay.ts`

**Done when:** Drag slider backward → canvas shows past state. Drag forward → canvas advances. Exit → returns to live.

**Rubric points unlocked:** Bonus feature (8 pts) ✅

---

## Feature 14: UI Polish (Hours 40–44)

**What:** Make it look like a product, not a school project.

**Implementation:**

1. **Color palette:** Pick 3 colors max. Use Tailwind's slate/zinc + one accent (blue/violet). Document in README.
2. **Typography:** One display font for headings (Inter or default sans), one body size, one small size. No more.
3. **Empty states:** Empty canvas shows "Double-click anywhere to start". Empty Task Board shows "Action items will appear here as your team writes them".
4. **Connection indicator:** Small dot in top-right — green (connected), yellow (reconnecting), red (offline).
5. **Onboarding:** First-time visitor sees a 3-step tooltip walkthrough (sticky / lock / task board).
6. **Loading states:** Skeleton for Task Board on initial load. Subtle shimmer on nodes being classified.

**Files:**
- `web/components/ConnectionStatus.tsx`
- `web/components/Onboarding.tsx`
- `web/app/globals.css` — design tokens

**Rubric points unlocked:** Visual consistency (3 pts), Canvas usability (8 pts), Responsiveness (4 pts) ✅

---

## Feature 15: README (Hours 44–46)

**What:** The judge-facing README. **5 points and easy to nail.**

**Required sections:**

1. **Elevator pitch** — one paragraph
2. **Architecture diagram** — use Mermaid, renders on GitHub
3. **Why CRDT + Event Sourcing** — explain the hybrid choice in plain language
4. **Conflict Resolution Strategy** — concrete example with Y.Text merge
5. **RBAC Enforcement** — show the actual server-side code path
6. **Trade-offs we accepted** — what you didn't build and why
7. **Setup & Run** — clone, install, env, dev, deploy

**Anti-pattern:** Don't ship the Next.js scaffold README. Judges will dock you 5 points for that.

---

## Feature 16: Final Deploy & Demo Prep (Hours 46–48)

1. Push final code, redeploy on Render
2. Hit the URL once 60 seconds before demo (free tier cold-starts)
3. Run the demo script 3 times end-to-end
4. Time it — must be under 4 minutes
5. **Last 90 minutes: untouchable buffer**

### Demo script (memorize this):

1. **Open with architecture pitch (30s):** "We treated this as two problems disguised as one — runtime convergence and durable history. Yjs solves runtime convergence. An append-only event log in Postgres solves durable history."
2. **Cursor presence (15s):** Open two tabs side-by-side. Move cursors.
3. **Conflict resolution (30s):** Both tabs type into the same sticky simultaneously. Show the merge.
4. **AI Task Board (30s):** Type "TODO: ship this demo". Task appears. Click jump button.
5. **RBAC bypass test (45s):** Open `wscat`, send a raw update from a viewer trying to modify a locked node. Server rejects. Show the rejection in logs.
6. **Time-Travel Replay (30s):** Drag the timeline slider backward. Watch the brainstorm rewind.
7. **Closing (10s):** Show the README architecture diagram.

---

## Team Allocation

| Person | Owns | Features |
|---|---|---|
| **A — Sync & Infra** | Yjs, WebSocket, persistence, replay, deploy | 1, 2, 7, 8, 13 |
| **B — Canvas & UX** | Konva, all canvas interactions, Task Board UI, polish | 3, 4, 5, 6, 11, 14 |
| **C — Backend Logic** | RBAC, AI classifier, README | 9, 10, 12, 15 |

---

## Hard Rules

1. **Never skip ahead.** Each feature depends on the last. Skipping = chaos.
2. **Test after each feature.** Don't accumulate bugs.
3. **Commit after each "Done when".** Tag commits like `feat: F3 cursor presence`.
4. **Sleep for 5 hours on day 1 night.** Tired RBAC code is broken RBAC code.
5. **Stop coding at hour 46.** The last 2 hours are for demo polish, not features.
6. **If something is 4 hours behind schedule, cut it.** A working 80-point submission beats a broken 95-point one.

---

## Score Tracking

Mark each as you complete it:

- [ ] F1 — Bare WebSocket Server
- [ ] F2 — Yjs Document Sync
- [ ] F3 — Cursor Presence (5 pts)
- [ ] F4 — Canvas Foundations
- [ ] F5 — Multi-Element Canvas
- [ ] F6 — Collaborative Text Editing (10 pts conflict + 10 pts sync = 20 pts)
- [ ] F7 — Event Log Persistence (8 pts)
- [ ] F8 — Reconnection & Replay
- [ ] F9 — Node-Level RBAC (7 pts)
- [ ] F10 — AI Intent Classification (10 pts)
- [ ] F11 — Live Task Board (8 pts)
- [ ] F12 — Event Log Sidebar
- [ ] F13 — Time-Travel Replay (8 pts bonus)
- [ ] F14 — UI Polish (15 pts UI/UX)
- [ ] F15 — README (5 pts)
- [ ] F16 — Final Deploy

**Maximum reachable score: 100 / 100**
**Realistic target: 88 / 100**

---

*Last updated: Day 0, Hour 0. Update this file as you go.*
