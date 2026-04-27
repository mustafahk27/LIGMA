CREATE TABLE IF NOT EXISTS canvas_nodes (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('sticky', 'text', 'rect', 'circle', 'pen')),
  x FLOAT NOT NULL DEFAULT 0,
  y FLOAT NOT NULL DEFAULT 0,
  width FLOAT NOT NULL DEFAULT 200,
  height FLOAT NOT NULL DEFAULT 150,
  content TEXT,
  color TEXT DEFAULT '#FFF9C4',
  points JSONB,
  intent TEXT CHECK (intent IN ('action_item', 'decision', 'open_question', 'reference', 'none')),
  acl JSONB NOT NULL DEFAULT '{"lead":["*"],"contributor":["view","edit"],"viewer":["view"]}',
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nodes_room ON canvas_nodes(room_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_nodes_intent ON canvas_nodes(room_id, intent) WHERE deleted_at IS NULL;
