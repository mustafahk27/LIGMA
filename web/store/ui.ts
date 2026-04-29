import { create } from 'zustand';
import type { Role } from '@/lib/node-types';
import type { HeatmapFilter } from '@/lib/heatmap';
import { STICKY_PALETTE } from '@/lib/node-types';

export type Tool =
  | 'select'
  | 'sticky'
  | 'text'
  | 'rect'
  | 'round_rect'
  | 'circle'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'erase'
  | 'zone';

interface UiStore {
  // ── Tool / selection ─────────────────────────────────────────────────────
  tool: Tool;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  setTool: (tool: Tool) => void;
  setSelected: (id: string | null) => void;
  setEditing: (id: string | null) => void;

  /** Next sticky placed with `createNode` uses this sticky paper color (synced when picking in format bar). */
  stickyDraftFill: string;
  setStickyDraftFill: (hex: string) => void;

  // ── Stage transform (pan + zoom) ─────────────────────────────────────────
  stageScale: number;
  stagePos: { x: number; y: number };
  setStage: (next: { scale?: number; x?: number; y?: number }) => void;

  // ── Identity (used by awareness + RBAC checks on the client) ─────────────
  role: Role;
  setRole: (role: Role) => void;

  heatmapVisible: boolean;
  heatmapFilter: HeatmapFilter;
  setHeatmapVisible: (v: boolean) => void;
  setHeatmapFilter: (f: HeatmapFilter) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  tool: 'select',
  selectedNodeId: null,
  editingNodeId: null,
  setTool: (tool) => set({ tool }),
  setSelected: (selectedNodeId) => set({ selectedNodeId }),
  setEditing: (editingNodeId) => set({ editingNodeId }),

  stickyDraftFill: STICKY_PALETTE[0]!,
  setStickyDraftFill: (stickyDraftFill) => set({ stickyDraftFill }),

  stageScale: 1,
  stagePos: { x: 0, y: 0 },
  setStage: ({ scale, x, y }) =>
    set((s) => ({
      stageScale: scale ?? s.stageScale,
      stagePos: { x: x ?? s.stagePos.x, y: y ?? s.stagePos.y },
    })),

  role: 'viewer',
  setRole: (role) => set({ role }),

  heatmapVisible: false,
  heatmapFilter: 'all',
  setHeatmapVisible: (heatmapVisible) => set({ heatmapVisible }),
  setHeatmapFilter: (heatmapFilter) => set({ heatmapFilter }),
}));
