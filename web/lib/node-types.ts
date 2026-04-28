import type * as Y from 'yjs';

export type NodeKind = 'sticky' | 'text' | 'rect' | 'circle' | 'pen';

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
  /** Used by the pen tool — flat array [x0, y0, x1, y1, …] in stage coords. */
  points: number[];
  content: string;
  author_id: string;
  created_at: number;
  acl: NodeAcl;
  intent: string | null;
}

export type NodeMap = Y.Map<unknown>;

export const STICKY_PALETTE = [
  '#fde68a',
  '#fca5a5',
  '#93c5fd',
  '#86efac',
  '#c4b5fd',
] as const;

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
