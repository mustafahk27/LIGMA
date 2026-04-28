'use client';

import * as Y from 'yjs';
import { ydoc, nodes } from './yjs';
import type { NodeKind, NodeSnapshot, NodeMap, NodeAcl } from './node-types';
import { DEFAULT_STICKY_TEXT, DEFAULT_TEXT_NODE_TEXT } from './node-types';

/** Random short id for new nodes. */
function freshId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export interface CreateNodeInput {
  type: NodeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  points?: number[];
  content?: string;
  author_id: string;
  /** Sticky + text nodes only — rich text styling. */
  fontSize?: number;
  textColor?: string;
  fontBold?: boolean;
  fontItalic?: boolean;
  textUnderline?: boolean;
}

/** Default geometry for each shape type. */
const DEFAULTS: Record<NodeKind, { width: number; height: number; fill: string; stroke: string }> = {
  sticky:  { width: 180, height: 140, fill: '#fde68a', stroke: '#0000' },
  text:    { width: 260, height: 56,  fill: '#0000',   stroke: '#0000' },
  rect:    { width: 160, height: 100, fill: '#1c2740', stroke: '#4575f3' },
  circle:  { width: 120, height: 120, fill: '#1c2740', stroke: '#8b5cf6' },
  pen:     { width: 0,   height: 0,   fill: '#0000',   stroke: '#dce6f5' },
};

/**
 * Create a node and add it to the shared Yjs map atomically.
 * `content` is stored as a Y.Text so collaborative typing works out of the box.
 */
export function createNode(input: CreateNodeInput): string {
  const id = freshId();
  const def = DEFAULTS[input.type];

  ydoc.transact(() => {
    const node = new Y.Map();
    node.set('id', id);
    node.set('type', input.type);
    node.set('x', input.x);
    node.set('y', input.y);
    node.set('width', input.width ?? def.width);
    node.set('height', input.height ?? def.height);
    node.set('rotation', 0);
    node.set('fill', input.fill ?? def.fill);
    node.set('stroke', input.stroke ?? def.stroke);
    node.set('points', input.points ?? []);
    node.set('author_id', input.author_id);
    node.set('created_at', Date.now());
    node.set('acl', { locked: false });
    node.set('intent', null);

    if (input.type === 'sticky') {
      const s = DEFAULT_STICKY_TEXT;
      node.set('fontSize', input.fontSize ?? s.fontSize);
      node.set('textColor', input.textColor ?? s.textColor);
      node.set('fontBold', input.fontBold ?? s.fontBold);
      node.set('fontItalic', input.fontItalic ?? s.fontItalic);
      node.set('textUnderline', input.textUnderline ?? s.textUnderline);
    } else if (input.type === 'text') {
      const s = DEFAULT_TEXT_NODE_TEXT;
      node.set('fontSize', input.fontSize ?? s.fontSize);
      node.set('textColor', input.textColor ?? s.textColor);
      node.set('fontBold', input.fontBold ?? s.fontBold);
      node.set('fontItalic', input.fontItalic ?? s.fontItalic);
      node.set('textUnderline', input.textUnderline ?? s.textUnderline);
    }

    const text = new Y.Text();
    if (input.content) text.insert(0, input.content);
    node.set('content', text);

    nodes.set(id, node);
  }, 'local');

  return id;
}

/** Patch one or more fields of a node inside a single Yjs transaction. */
export function updateNode(
  id: string,
  patch: Partial<
    Omit<NodeSnapshot, 'id' | 'content' | 'created_at' | 'author_id'>
  >,
): void {
  const node = nodes.get(id);
  if (!node) return;

  ydoc.transact(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      node.set(k, v as unknown);
    }
  }, 'local');
}

/** Append points to a pen stroke, used during freehand drawing. */
export function appendPenPoints(id: string, extra: number[]): void {
  const node = nodes.get(id);
  if (!node) return;
  const current = (node.get('points') as number[] | undefined) ?? [];
  ydoc.transact(() => {
    node.set('points', [...current, ...extra]);
  }, 'local');
}

export function deleteNode(id: string): void {
  if (!nodes.has(id)) return;
  ydoc.transact(() => {
    nodes.delete(id);
  }, 'local');
}

export function setNodeAcl(id: string, acl: NodeAcl): void {
  const node = nodes.get(id);
  if (!node) return;
  ydoc.transact(() => {
    node.set('acl', acl);
  }, 'local');
}

/** Read-only conversion of a Y.Map node into a plain object for rendering. */
export function nodeToSnapshot(map: NodeMap): NodeSnapshot {
  const content = map.get('content');
  const type = (map.get('type') as NodeKind) ?? 'sticky';
  const stickyDefaults = DEFAULT_STICKY_TEXT;
  const textDefaults = DEFAULT_TEXT_NODE_TEXT;
  const textBase = type === 'sticky' ? stickyDefaults : textDefaults;

  return {
    id: (map.get('id') as string) ?? '',
    type,
    x: (map.get('x') as number) ?? 0,
    y: (map.get('y') as number) ?? 0,
    width: (map.get('width') as number) ?? 0,
    height: (map.get('height') as number) ?? 0,
    rotation: (map.get('rotation') as number) ?? 0,
    fill: (map.get('fill') as string) ?? '#1c2740',
    stroke: (map.get('stroke') as string) ?? '#0000',
    points: (map.get('points') as number[]) ?? [],
    content: content instanceof Y.Text ? content.toString() : (content as string) ?? '',
    author_id: (map.get('author_id') as string) ?? '',
    created_at: (map.get('created_at') as number) ?? 0,
    acl: ((map.get('acl') as NodeAcl) ?? { locked: false }),
    intent: (map.get('intent') as string | null) ?? null,
    fontSize: typeof map.get('fontSize') === 'number' ? (map.get('fontSize') as number) : textBase.fontSize,
    textColor: typeof map.get('textColor') === 'string' ? (map.get('textColor') as string) : textBase.textColor,
    fontBold: typeof map.get('fontBold') === 'boolean' ? (map.get('fontBold') as boolean) : textBase.fontBold,
    fontItalic: typeof map.get('fontItalic') === 'boolean' ? (map.get('fontItalic') as boolean) : textBase.fontItalic,
    textUnderline:
      typeof map.get('textUnderline') === 'boolean'
        ? (map.get('textUnderline') as boolean)
        : textBase.textUnderline,
  };
}

/** Returns the live Y.Text for a node (used by EditableText). */
export function getNodeText(id: string): Y.Text | null {
  const node = nodes.get(id);
  if (!node) return null;
  const c = node.get('content');
  return c instanceof Y.Text ? c : null;
}
