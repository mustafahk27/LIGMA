'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Group, Rect, Circle, Line, Text } from 'react-konva';
import type Konva from 'konva';
import type { NodeSnapshot, Role } from '@/lib/node-types';
import { canActOnNode } from '@/lib/node-types';
import { updateNode } from '@/lib/nodes';
import { nodeLocalContentBounds } from '@/lib/selection-bounds';

interface ShapeRendererProps {
  node: NodeSnapshot;
  isSelected: boolean;
  isEditing: boolean;
  role: Role;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

/**
 * Single dispatch point that switches on `node.type` and renders the right
 * Konva primitive. Every renderer is wrapped in a `<Group>` so the same
 * drag, select, and overlay logic applies regardless of shape.
 */
export function ShapeRenderer({
  node,
  isSelected,
  isEditing,
  role,
  onSelect,
  onDoubleClick,
  onDragStart,
  onDragEnd,
}: ShapeRendererProps) {
  const writable = canActOnNode(role, node.acl);
  const draggable = writable && !isEditing;

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    onDragEnd(node.id, e.target.x(), e.target.y());
  }

  return (
    <Group
      x={node.x}
      y={node.y}
      rotation={node.rotation}
      draggable={draggable}
      onDragStart={() => onDragStart(node.id)}
      onDragEnd={handleDragEnd}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(node.id);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(node.id);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        if (writable) onDoubleClick(node.id);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        if (writable) onDoubleClick(node.id);
      }}
    >
      <ShapeBody node={node} isEditing={isEditing} isSelected={isSelected} />
      {isSelected && node.type !== 'text' && <SelectionOutline node={node} />}
      {node.acl.locked && <LockBadge node={node} />}
    </Group>
  );
}

/* ── Body dispatcher ───────────────────────────────────────────────────────── */

function ShapeBody({
  node,
  isEditing,
  isSelected,
}: {
  node: NodeSnapshot;
  isEditing: boolean;
  isSelected: boolean;
}) {
  switch (node.type) {
    case 'sticky':
      return <StickyBody node={node} isEditing={isEditing} />;
    case 'text':
      return <TextBody node={node} isEditing={isEditing} isSelected={isSelected} />;
    case 'rect':
      return <RectBody node={node} />;
    case 'circle':
      return <CircleBody node={node} />;
    case 'pen':
      return <PenBody node={node} />;
    default:
      return null;
  }
}

/* ── Per-type bodies ───────────────────────────────────────────────────────── */

function StickyBody({ node, isEditing }: { node: NodeSnapshot; isEditing: boolean }) {
  return (
    <>
      <Rect
        width={node.width}
        height={node.height}
        fill={node.fill}
        cornerRadius={8}
        shadowColor="#000"
        shadowBlur={10}
        shadowOpacity={0.25}
        shadowOffset={{ x: 0, y: 4 }}
      />
      {!isEditing && (
        <Text
          text={node.content || 'Double-click to edit'}
          x={12}
          y={12}
          width={node.width - 24}
          height={node.height - 24}
          fontSize={14}
          fontStyle={node.content ? 'normal' : 'italic'}
          fill={node.content ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.35)'}
          fontFamily="Inter, system-ui, sans-serif"
          lineHeight={1.4}
          wrap="word"
          listening={false}
        />
      )}
      {node.intent && <IntentBadge intent={node.intent} />}
    </>
  );
}

function TextBody({
  node,
  isEditing,
  isSelected,
}: {
  node: NodeSnapshot;
  isEditing: boolean;
  isSelected: boolean;
}) {
  const textRef = useRef<Konva.Text>(null);
  const [layoutH, setLayoutH] = useState(() => Math.max(node.height, 24));

  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    if (isEditing) {
      setLayoutH(Math.max(node.height, 24));
      return;
    }
    const measured = Math.ceil(t.height());
    setLayoutH(Math.max(measured, 24));
    if (measured > 0 && Math.abs(measured - node.height) >= 1) {
      updateNode(node.id, { height: measured });
    }
  }, [node.content, node.width, node.height, isEditing, node.id]);

  const outlineH = Math.max(layoutH, node.height, 24);

  return (
    <>
      <Text
        ref={textRef}
        text={isEditing ? '' : node.content || 'Text'}
        width={node.width}
        fontSize={20}
        fontStyle={node.content ? 'normal' : 'italic'}
        fill={node.content ? '#dce6f5' : '#3d4f6e'}
        fontFamily="Inter, system-ui, sans-serif"
        lineHeight={1.3}
        wrap="word"
        listening={!isEditing}
      />
      {isSelected && (
        <Rect
          x={-4}
          y={-4}
          width={node.width + 8}
          height={outlineH + 8}
          stroke="#4575f3"
          strokeWidth={1.5}
          dash={[6, 4]}
          cornerRadius={10}
          listening={false}
        />
      )}
    </>
  );
}

function RectBody({ node }: { node: NodeSnapshot }) {
  return (
    <Rect
      width={node.width}
      height={node.height}
      fill={node.fill}
      stroke={node.stroke}
      strokeWidth={2}
      cornerRadius={6}
    />
  );
}

function CircleBody({ node }: { node: NodeSnapshot }) {
  const r = Math.max(node.width, node.height) / 2;
  return (
    <Circle
      x={r}
      y={r}
      radius={r}
      fill={node.fill}
      stroke={node.stroke}
      strokeWidth={2}
    />
  );
}

function PenBody({ node }: { node: NodeSnapshot }) {
  return (
    <Line
      points={node.points}
      stroke={node.stroke}
      strokeWidth={2.5}
      lineCap="round"
      lineJoin="round"
      tension={0.3}
      hitStrokeWidth={14}
    />
  );
}

/* ── Decorations ───────────────────────────────────────────────────────────── */

function SelectionOutline({ node }: { node: NodeSnapshot }) {
  if (node.type === 'circle') {
    const r = Math.max(node.width, node.height) / 2;
    return (
      <Circle
        x={r}
        y={r}
        radius={r + 4}
        stroke="#4575f3"
        strokeWidth={1.5}
        dash={[6, 4]}
        listening={false}
      />
    );
  }
  const b = nodeLocalContentBounds(node);
  const cornerRadius = node.type === 'pen' ? 6 : 10;
  return (
    <Rect
      x={b.x - 4}
      y={b.y - 4}
      width={b.width + 8}
      height={b.height + 8}
      stroke="#4575f3"
      strokeWidth={1.5}
      dash={[6, 4]}
      cornerRadius={cornerRadius}
      listening={false}
    />
  );
}

function LockBadge({ node }: { node: NodeSnapshot }) {
  const b = nodeLocalContentBounds(node);
  // padlock SVG path drawn as a small overlay on the top-right corner
  return (
    <Group x={b.x + b.width - 20} y={b.y + 4} listening={false}>
      <Rect width={16} height={16} cornerRadius={4} fill="#0c1020" opacity={0.85} />
      <Text
        text="🔒"
        fontSize={11}
        x={2}
        y={2}
        fill="#fbbf24"
      />
    </Group>
  );
}

const INTENT_COLORS: Record<string, string> = {
  action_item: '#4575f3',
  decision: '#34d399',
  open_question: '#fbbf24',
  reference: '#8b5cf6',
};

function IntentBadge({ intent }: { intent: string }) {
  const color = INTENT_COLORS[intent] ?? '#7a8da8';
  return (
    <Group x={8} y={-10} listening={false}>
      <Rect width={84} height={16} cornerRadius={8} fill={color} opacity={0.9} />
      <Text
        text={intent.replace('_', ' ')}
        fontSize={9}
        fontStyle="bold"
        fill="#fff"
        x={10}
        y={3}
        fontFamily="Inter, system-ui, sans-serif"
      />
    </Group>
  );
}
