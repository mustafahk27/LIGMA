import { create } from 'zustand';
import type { Role } from '@/lib/node-types';

export type Tool = 'select' | 'sticky' | 'text' | 'rect' | 'circle' | 'pen';

interface UiStore {
  // ── Tool / selection ─────────────────────────────────────────────────────
  tool: Tool;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  setTool: (tool: Tool) => void;
  setSelected: (id: string | null) => void;
  setEditing: (id: string | null) => void;

  // ── Stage transform (pan + zoom) ─────────────────────────────────────────
  stageScale: number;
  stagePos: { x: number; y: number };
  setStage: (next: { scale?: number; x?: number; y?: number }) => void;

  // ── Identity (used by awareness + RBAC checks on the client) ─────────────
  role: Role;
  setRole: (role: Role) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  tool: 'select',
  selectedNodeId: null,
  editingNodeId: null,
  setTool: (tool) => set({ tool }),
  setSelected: (selectedNodeId) => set({ selectedNodeId }),
  setEditing: (editingNodeId) => set({ editingNodeId }),

  stageScale: 1,
  stagePos: { x: 0, y: 0 },
  setStage: ({ scale, x, y }) =>
    set((s) => ({
      stageScale: scale ?? s.stageScale,
      stagePos: { x: x ?? s.stagePos.x, y: y ?? s.stagePos.y },
    })),

  role: 'viewer',
  setRole: (role) => set({ role }),
}));
