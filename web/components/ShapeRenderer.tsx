'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Group, Rect, Ellipse, Line, Arrow, Text } from 'react-konva';
import type Konva from 'konva';
import type { NodeSnapshot, Role } from '@/lib/node-types';
import { canActOnNode } from '@/lib/node-types';
import { updateNode } from '@/lib/nodes';
import { nodeLocalContentBounds } from '@/lib/selection-bounds';
import { dimHex, konvaFontStyle } from '@/lib/text-style';
import type { Tool } from '@/store/ui';

interface ShapeRendererProps {
  node: NodeSnapshot;
  isSelected: boolean;
  isEditing: boolean;
  /** When true (select tool, can edit, non-pen), Transformer draws handles — hide duplicate selection chrome. */
  showResizeChrome: boolean;
  /** While a transform is in progress — disable node drag so resizing doesn't fight pointer. */
  isTransforming: boolean;
  setGroupRef: (id: string, node: Konva.Group | null) => void;
  role: Role;
  tool: Tool;
  onSelect: (id: string) => void;
  onErase: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onDragStart: (id: string) => void;
  /** Called while dragging (template groups move siblings together via Canvas). */
  onDragMove?: (id: string, x: number, y: number) => void;
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
  showResizeChrome,
  isTransforming,
  setGroupRef,
  role,
  tool,
  onSelect,
  onErase,
  onDoubleClick,
  onDragStart,
  onDragMove,
  onDragEnd,
}: ShapeRendererProps) {
  const writable = canActOnNode(role, node.acl);
  const draggable = writable && !isEditing && !(isSelected && isTransforming);

  function handleDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    onDragEnd(node.id, e.target.x(), e.target.y());
  }

  return (
    <Group
      ref={(el) => setGroupRef(node.id, el)}
      name={node.id}
      x={node.x}
      y={node.y}
      rotation={node.rotation}
      draggable={draggable}
      onDragStart={() => onDragStart(node.id)}
      onDragMove={
        onDragMove
          ? (e: Konva.KonvaEventObject<DragEvent>) =>
              onDragMove(node.id, e.target.x(), e.target.y())
          : undefined
      }
      onDragEnd={handleDragEnd}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        if (tool === 'erase') {
          if (writable) onErase(node.id);
          return;
        }
        onSelect(node.id);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        if (tool === 'erase') {
          if (writable) onErase(node.id);
          return;
        }
        onSelect(node.id);
      }}
      onMouseEnter={(e) => {
        if (tool !== 'erase' || !writable) return;
        if ((e.evt.buttons & 1) === 1) {
          e.cancelBubble = true;
          onErase(node.id);
        }
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
      <ShapeBody node={node} isEditing={isEditing} isSelected={isSelected} showResizeChrome={showResizeChrome} />
      {isSelected &&
        node.type !== 'text' &&
        (!showResizeChrome ||
          node.type === 'pen' ||
          node.type === 'line' ||
          node.type === 'arrow') && <SelectionOutline node={node} />}
      {node.acl.locked && <LockBadge node={node} />}
    </Group>
  );
}

/* ── Body dispatcher ───────────────────────────────────────────────────────── */

function ShapeBody({
  node,
  isEditing,
  isSelected,
  showResizeChrome,
}: {
  node: NodeSnapshot;
  isEditing: boolean;
  isSelected: boolean;
  showResizeChrome: boolean;
}) {
  switch (node.type) {
    case 'sticky':
      return <StickyBody node={node} isEditing={isEditing} />;
    case 'text':
      return (
        <TextBody node={node} isEditing={isEditing} isSelected={isSelected} showResizeChrome={showResizeChrome} />
      );
    case 'rect':
    case 'round_rect':
      return <RectBody node={node} />;
    case 'circle':
      return <CircleBody node={node} />;
    case 'pen':
      return <PenBody node={node} />;
    case 'line':
      return <LineSegmentBody node={node} />;
    case 'arrow':
      return <ArrowSegmentBody node={node} />;
    default:
      return null;
  }
}

/* ── Per-type bodies ───────────────────────────────────────────────────────── */

function StickyBody({ node, isEditing }: { node: NodeSnapshot; isEditing: boolean }) {
  const fill = node.content ? node.textColor : dimHex(node.textColor, 0.38);
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
          fontSize={node.fontSize}
          fontStyle={node.content ? konvaFontStyle(node.fontBold, node.fontItalic) : 'italic'}
          fill={fill}
          fontFamily="Inter, system-ui, sans-serif"
          lineHeight={1.4}
          wrap="word"
          listening={false}
          textDecoration={node.textUnderline ? 'underline' : undefined}
        />
      )}
      {node.intent && node.intent !== 'none' && <IntentBadge intent={node.intent} />}
    </>
  );
}

function TextBody({
  node,
  isEditing,
  isSelected,
  showResizeChrome,
}: {
  node: NodeSnapshot;
  isEditing: boolean;
  isSelected: boolean;
  showResizeChrome: boolean;
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
    setLayoutH(Math.max(measured, node.height, 24));
    if (measured > node.height + 1) {
      updateNode(node.id, { height: measured });
    }
  }, [node.content, node.width, node.height, node.fontSize, node.fontBold, node.fontItalic, node.textColor, isEditing, node.id]);

  const outlineH = Math.max(layoutH, node.height, 24);

  return (
    <>
      <Text
        ref={textRef}
        text={isEditing ? '' : node.content || 'Text'}
        width={node.width}
        fontSize={node.fontSize}
        fontStyle={node.content ? konvaFontStyle(node.fontBold, node.fontItalic) : 'italic'}
        fill={
          node.content ? node.textColor : dimHex(node.textColor, 0.42)
        }
        fontFamily="Inter, system-ui, sans-serif"
        lineHeight={1.3}
        wrap="word"
        listening={!isEditing}
        textDecoration={node.textUnderline ? 'underline' : undefined}
      />
      {isSelected && !showResizeChrome && (
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
  const rCap = Math.min(node.width / 2, node.height / 2);
  const r = Math.min(Math.max(0, node.cornerRadius || 6), rCap);
  return (
    <Rect
      width={node.width}
      height={node.height}
      fill={node.fill}
      stroke={node.stroke}
      strokeWidth={2}
      cornerRadius={r}
    />
  );
}

function CircleBody({ node }: { node: NodeSnapshot }) {
  const rx = node.width / 2;
  const ry = node.height / 2;
  return (
    <Ellipse
      x={rx}
      y={ry}
      radiusX={rx}
      radiusY={ry}
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

function LineSegmentBody({ node }: { node: NodeSnapshot }) {
  const pts = node.points;
  if (pts.length < 4) return null;
  return (
    <Line
      points={pts}
      stroke={node.stroke}
      strokeWidth={2.5}
      lineCap="round"
      lineJoin="round"
      hitStrokeWidth={16}
    />
  );
}

function ArrowSegmentBody({ node }: { node: NodeSnapshot }) {
  const pts = node.points;
  if (pts.length < 4) return null;
  return (
    <Arrow
      points={pts}
      stroke={node.stroke}
      fill={node.stroke}
      strokeWidth={2.5}
      pointerLength={12}
      pointerWidth={12}
      lineCap="round"
      lineJoin="round"
      hitStrokeWidth={16}
    />
  );
}

/* ── Decorations ───────────────────────────────────────────────────────────── */

function SelectionOutline({ node }: { node: NodeSnapshot }) {
  if (node.type === 'circle') {
    const rx = node.width / 2 + 4;
    const ry = node.height / 2 + 4;
    return (
      <Ellipse
        x={node.width / 2}
        y={node.height / 2}
        radiusX={rx}
        radiusY={ry}
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
