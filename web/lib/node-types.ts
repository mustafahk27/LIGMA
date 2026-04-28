import type * as Y from 'yjs';

export type NodeKind =
  | 'sticky'
  | 'text'
  | 'rect'
  | 'round_rect'
  | 'circle'
  | 'pen'
  | 'line'
  | 'arrow';

export interface NodeAcl {
  /** When true only leads may mutate this node. */
  locked: boolean;
}

/**
 * Plain (non-Yjs) snapshot of a node — what UI components consume after
 * resolving the underlying `Y.Map`. The `content` field is denormalised
 * to a string here for rendering; the live Y.Text is read separately
 * for collaborative editing.
 */
export interface NodeSnapshot {
  id: string;
  type: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  /** Corner radius for `rect` / `round_rect` (canvas units). */
  cornerRadius: number;
  /** Used by the pen tool — flat array [x0, y0, x1, y1, …] in stage coords. */
  points: number[];
  content: string;
  author_id: string;
  created_at: number;
  acl: NodeAcl;
  intent: string | null;
  /**
   * Rich text (sticky + text). Other node types ignore these; defaults are filled in
   * `nodeToSnapshot` when keys are missing for backward compatibility.
   */
  fontSize: number;
  textColor: string;
  fontBold: boolean;
  fontItalic: boolean;
  textUnderline: boolean;
}

export type NodeMap = Y.Map<unknown>;

export const STICKY_PALETTE = [
  '#fde68a',
  '#fca5a5',
  '#93c5fd',
  '#86efac',
  '#c4b5fd',
] as const;

export const DEFAULT_STICKY_TEXT = {
  fontSize: 14,
  textColor: '#1c1917',
  fontBold: false,
  fontItalic: false,
  textUnderline: false,
} as const;

export const DEFAULT_TEXT_NODE_TEXT = {
  fontSize: 20,
  textColor: '#dce6f5',
  fontBold: false,
  fontItalic: false,
  textUnderline: false,
} as const;

/** Preset steps for the format bar font-size control. */
export const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32] as const;

export type Role = 'lead' | 'contributor' | 'viewer';

/**
 * Returns true when the actor's role is allowed to mutate the given ACL.
 * Mirrors the server-side RBAC check.
 */
export function canActOnNode(role: Role, acl: NodeAcl | undefined): boolean {
  if (role === 'viewer') return false;
  if (acl?.locked && role !== 'lead') return false;
  return true;
}
