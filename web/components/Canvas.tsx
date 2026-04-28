'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Stage, Layer } from 'react-konva';
import type Konva from 'konva';
import { Cursors } from './Cursors';
import { EditableText } from './EditableText';
import { AclEditor } from './AclEditor';
import { ShapeRenderer } from './ShapeRenderer';
import {
  appendPenPoints,
  createNode,
  deleteNode,
  updateNode,
} from '@/lib/nodes';
import { useYjsNodes } from '@/lib/use-yjs-nodes';
import { useUiStore, type Tool } from '@/store/ui';
import { setLocalCursor } from '@/lib/awareness-identity';
import type { NodeSnapshot, Role } from '@/lib/node-types';
import { canActOnNode } from '@/lib/node-types';

interface CanvasProps {
  userId: string;
  role: Role;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const CURSOR_THROTTLE_MS = 30;

export default function Canvas({ userId, role }: CanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Live tool & selection state
  const tool = useUiStore((s) => s.tool);
  const selectedNodeId = useUiStore((s) => s.selectedNodeId);
  const editingNodeId = useUiStore((s) => s.editingNodeId);
  const stageScale = useUiStore((s) => s.stageScale);
  const stagePos = useUiStore((s) => s.stagePos);
  const setStage = useUiStore((s) => s.setStage);
  const setSelected = useUiStore((s) => s.setSelected);
  const setEditing = useUiStore((s) => s.setEditing);
  const setTool = useUiStore((s) => s.setTool);

  const nodes = useYjsNodes();

  // Drag-creation state for rect/circle and freehand pen
  const dragState = useRef<{
    nodeId: string | null;
    startStage: { x: number; y: number };
    type: Tool;
  } | null>(null);

  /* ── Resize observer ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ── Delete key removes selected node ───────────────────────────────── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (node && canActOnNode(role, node.acl)) {
          deleteNode(selectedNodeId);
          setSelected(null);
        }
      }
      if (e.key === 'Escape') {
        setSelected(null);
        setEditing(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, nodes, role, setSelected, setEditing]);

  /* ── Coordinate helpers ─────────────────────────────────────────────── */
  /** Convert a pointer position (in screen coords) to stage (canvas) coords. */
  const toStageCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const stage = stageRef.current;
      if (!stage) return { x: 0, y: 0 };
      const rect = stage.container().getBoundingClientRect();
      return {
        x: (clientX - rect.left - stagePos.x) / stageScale,
        y: (clientY - rect.top - stagePos.y) / stageScale,
      };
    },
    [stageScale, stagePos.x, stagePos.y],
  );

  /* ── Wheel zoom (around mouse pointer) ──────────────────────────────── */
  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.1;
    const newScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, direction > 0 ? oldScale * factor : oldScale / factor),
    );

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    setStage({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }

  /* ── Awareness cursor (throttled) ───────────────────────────────────── */
  const lastCursorAt = useRef(0);
  function onMouseMoveStage(e: Konva.KonvaEventObject<MouseEvent>) {
    const now = performance.now();
    if (now - lastCursorAt.current < CURSOR_THROTTLE_MS) return;
    lastCursorAt.current = now;

    const pos = toStageCoords(e.evt.clientX, e.evt.clientY);
    setLocalCursor(pos.x, pos.y);

    handleCreationDrag(pos);
  }

  function onMouseLeaveStage() {
    setLocalCursor(null);
  }

  /* ── Create / drag-create handlers ──────────────────────────────────── */

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    // Click on a shape -> Group's own handler runs first; we check target here
    const stage = stageRef.current;
    if (!stage) return;
    const clickedEmpty = e.target === stage;

    if (!clickedEmpty) return; // shapes handle their own selection
    if (role === 'viewer') return;

    const pos = toStageCoords(e.evt.clientX, e.evt.clientY);

    if (tool === 'select') {
      setSelected(null);
      setEditing(null);
      return;
    }

    if (tool === 'sticky' || tool === 'text') {
      const id = createNode({
        type: tool,
        x: pos.x,
        y: pos.y,
        author_id: userId,
      });
      setSelected(id);
      // Auto-enter edit mode for fresh stickies / text blocks
      setEditing(id);
      // Snap back to select tool so the user isn't surprised next click
      setTool('select');
      return;
    }

    if (tool === 'rect' || tool === 'circle' || tool === 'pen') {
      const id = createNode({
        type: tool,
        x: pos.x,
        y: pos.y,
        width: tool === 'pen' ? 0 : 1,
        height: tool === 'pen' ? 0 : 1,
        points: tool === 'pen' ? [0, 0] : [],
        author_id: userId,
      });
      dragState.current = { nodeId: id, startStage: pos, type: tool };
      setSelected(id);
      return;
    }
  }

  function handleCreationDrag(pos: { x: number; y: number }) {
    const drag = dragState.current;
    if (!drag || !drag.nodeId) return;

    if (drag.type === 'rect' || drag.type === 'circle') {
      const dx = pos.x - drag.startStage.x;
      const dy = pos.y - drag.startStage.y;
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      // Anchor so dragging up-left grows correctly
      updateNode(drag.nodeId, {
        x: dx < 0 ? pos.x : drag.startStage.x,
        y: dy < 0 ? pos.y : drag.startStage.y,
        width: Math.max(w, 8),
        height: Math.max(h, 8),
      });
    } else if (drag.type === 'pen') {
      const local = [pos.x - drag.startStage.x, pos.y - drag.startStage.y];
      appendPenPoints(drag.nodeId, local);
    }
  }

  function handleStageMouseUp() {
    if (dragState.current) {
      // Pen strokes with one or zero points feel like accidental clicks
      const id = dragState.current.nodeId;
      if (id && dragState.current.type === 'pen') {
        const node = nodes.find((n) => n.id === id);
        if (node && node.points.length < 4) deleteNode(id);
      }
      dragState.current = null;
    }
  }

  /* ── Stage drag (pan) handlers ──────────────────────────────────────── */
  function onStageDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    if (e.target !== stageRef.current) return;
    setStage({ x: e.target.x(), y: e.target.y() });
  }

  /* ── Render helpers ─────────────────────────────────────────────────── */
  const editingNode = nodes.find((n) => n.id === editingNodeId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Stage is only draggable when in select mode — drawing tools want the drag
  const stageDraggable = tool === 'select' && !editingNodeId;

  return (
    <div ref={containerRef} className="absolute inset-0 dot-grid overflow-hidden">
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={stageDraggable}
        onWheel={onWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={onMouseMoveStage}
        onMouseUp={handleStageMouseUp}
        onMouseLeave={onMouseLeaveStage}
        onDragMove={onStageDragMove}
        style={{
          cursor: stageDraggable ? 'grab' : 'crosshair',
        }}
      >
        <Layer>
          {nodes.map((node) => (
            <ShapeRenderer
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
              isEditing={node.id === editingNodeId}
              role={role}
              onSelect={(id) => setSelected(id)}
              onDoubleClick={(id) => setEditing(id)}
              onDragStart={(id) => setSelected(id)}
              onDragEnd={(id, x, y) => updateNode(id, { x, y })}
            />
          ))}
        </Layer>
      </Stage>

      {/* Cursor overlay (HTML on top of Konva) */}
      <Cursors stagePos={stagePos} stageScale={stageScale} />

      {/* Inline text editor for the currently-edited sticky / text node */}
      {editingNode && (
        <EditableText
          node={editingNode}
          stagePos={stagePos}
          stageScale={stageScale}
          onClose={() => setEditing(null)}
        />
      )}

      {/* ACL editor anchored to selected node (lead-only) */}
      {selectedNode && role === 'lead' && !editingNodeId && (
        <AclEditor
          node={selectedNode}
          stagePos={stagePos}
          stageScale={stageScale}
        />
      )}

      {/* Empty-state hint */}
      {nodes.length === 0 && <EmptyHint tool={tool} />}
    </div>
  );
}

function EmptyHint({ tool }: { tool: Tool }) {
  const hints: Record<Tool, string> = {
    select: 'Drag to pan · Scroll to zoom · Pick a tool to start',
    sticky: 'Click anywhere to place a sticky note',
    text: 'Click anywhere to add text',
    rect: 'Click and drag to draw a rectangle',
    circle: 'Click and drag to draw a circle',
    pen: 'Click and drag to draw freehand',
  };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
      <p className="text-xs font-mono text-[var(--text-3)] uppercase tracking-widest">
        {hints[tool]}
      </p>
    </div>
  );
}
