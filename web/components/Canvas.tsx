'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Stage, Layer, Transformer } from 'react-konva';
import type Konva from 'konva';
import { Cursors } from './Cursors';
import { EditableText } from './EditableText';
import { AclEditor } from './AclEditor';
import { ShapeRenderer } from './ShapeRenderer';
import { NodeFormatBar } from './NodeFormatBar';
import { SelectionLayerBar } from './SelectionLayerBar';
import { TemplateMenu } from './TemplateMenu';
import { Minimap } from './Minimap';
import { startHeatmapTracking, stopHeatmapTracking, trackActivity } from '@/lib/heatmap';
import {
  appendPenPoints,
  createNode,
  deleteNode,
  duplicateNode,
  layerBringForward,
  layerSendBackward,
  updateNode,
} from '@/lib/nodes';
import { nodes as yjsNodesMap } from '@/lib/yjs';
import * as Y from 'yjs';
import { useYjsNodes } from '@/lib/use-yjs-nodes';
import { useUiStore, type Tool } from '@/store/ui';
import { setLocalCursor } from '@/lib/awareness-identity';
import type { NodeSnapshot, Role } from '@/lib/node-types';
import { canActOnNode } from '@/lib/node-types';

interface CanvasProps {
  userId: string;
  role: Role;
  onStageReady?: (stage: Konva.Stage) => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const CURSOR_THROTTLE_MS = 30;

/** Minimum node size after transform (canvas units). */
const MIN_RESIZE_W = 8;
const MIN_RESIZE_H = 8;
const MIN_TEXT_RESIZE_W = 40;
const MIN_TEXT_RESIZE_H = 24;
const MIN_STICKY_RESIZE_W = 72;
const MIN_STICKY_RESIZE_H = 52;

/** Text nodes: width-only resize (height follows content via EditableText / TextBody). */
const TRANSFORM_ANCHORS_HORIZONTAL: string[] = ['middle-left', 'middle-right'];

const TRANSFORM_ANCHORS_ALL: string[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'bottom-right',
  'bottom-center',
  'bottom-left',
  'middle-left',
];

function commitGroupResize(group: Konva.Group, snapshot: NodeSnapshot): void {
  const scaleX = group.scaleX();
  const scaleY = group.scaleY();
  const baseW = group.width() || snapshot.width;
  const baseH = group.height() || snapshot.height;

  let newW = Math.max(MIN_RESIZE_W, baseW * scaleX);
  let newH = Math.max(MIN_RESIZE_H, baseH * scaleY);

  if (snapshot.type === 'sticky') {
    newW = Math.max(MIN_STICKY_RESIZE_W, newW);
    newH = Math.max(MIN_STICKY_RESIZE_H, newH);
  } else if (snapshot.type === 'text') {
    newW = Math.max(MIN_TEXT_RESIZE_W, newW);
    newH = Math.max(MIN_TEXT_RESIZE_H, newH);
  }

  group.scaleX(1);
  group.scaleY(1);

  if (snapshot.type === 'text') {
    updateNode(snapshot.id, {
      x: group.x(),
      y: group.y(),
      width: Math.round(newW * 100) / 100,
      height: snapshot.height,
    });
    return;
  }

  updateNode(snapshot.id, {
    x: group.x(),
    y: group.y(),
    width: Math.round(newW * 100) / 100,
    height: Math.round(newH * 100) / 100,
  });
}

export default function Canvas({ userId, role, onStageReady }: CanvasProps) {
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
  const stickyDraftFill = useUiStore((s) => s.stickyDraftFill);
  const setTool = useUiStore((s) => s.setTool);
  const heatmapVisible = useUiStore((s) => s.heatmapVisible);
  const heatmapFilter = useUiStore((s) => s.heatmapFilter);

  const nodes = useYjsNodes();

  const transformerRef = useRef<Konva.Transformer>(null);
  const groupRefs = useRef<Map<string, Konva.Group>>(new Map());
  /** Template / frame: shared group_id — drag moves all peers together. */
  const groupDragRef = useRef<{
    groupId: string;
    start: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);

  useEffect(() => {
    startHeatmapTracking(userId);
    return () => stopHeatmapTracking();
  }, [userId]);

  const eraseNodeOrGroup = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node || !canActOnNode(role, node.acl)) return;

      const toRemove =
        node.group_id && node.group_id.length > 0
          ? nodes.filter((n) => n.group_id === node.group_id && canActOnNode(role, n.acl))
          : [node];

      if (toRemove.length === 0) return;

      toRemove.forEach((n) => deleteNode(n.id));
      if (selectedNodeId && toRemove.some((n) => n.id === selectedNodeId)) {
        setSelected(null);
        setEditing(null);
      }
    },
    [nodes, role, selectedNodeId, setEditing, setSelected],
  );

  const setGroupRef = useCallback((id: string, nodeEl: Konva.Group | null) => {
    const m = groupRefs.current;
    if (nodeEl) m.set(id, nodeEl);
    else m.delete(id);
  }, []);

  const handleShapeDragStart = useCallback(
    (id: string) => {
      setSelected(id);
      const n = nodes.find((x) => x.id === id);
      if (!n?.group_id) return;
      const gid = n.group_id;
      const peers = nodes.filter((no) => no.group_id === gid);
      const start: Record<string, { x: number; y: number }> = {};
      peers.forEach((p) => {
        start[p.id] = { x: p.x, y: p.y };
      });
      groupDragRef.current = { groupId: gid, start };
    },
    [nodes, setSelected],
  );

  const handleShapeDragMove = useCallback((id: string, x: number, y: number) => {
    const st = groupDragRef.current;
    if (!st) return;
    const sel = nodes.find((n) => n.id === id);
    if (sel?.group_id !== st.groupId || !st.start[id]) return;
    const origin = st.start[id]!;
    const dx = x - origin.x;
    const dy = y - origin.y;
    for (const nid of Object.keys(st.start)) {
      if (nid === id) continue;
      const g = groupRefs.current.get(nid);
      const s = st.start[nid];
      if (g && s) g.position({ x: s.x + dx, y: s.y + dy });
    }
    trackActivity(x, y, 2);
  }, [nodes]);

  const handleShapeDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      const st = groupDragRef.current;
      const sel = nodes.find((n) => n.id === id);
      if (st && sel?.group_id === st.groupId && st.start[id]) {
        const origin = st.start[id]!;
        const dx = x - origin.x;
        const dy = y - origin.y;
        groupDragRef.current = null;
        for (const nid of Object.keys(st.start)) {
          const s = st.start[nid]!;
          updateNode(nid, { x: s.x + dx, y: s.y + dy });
        }
        return;
      }
      groupDragRef.current = null;
      if (!sel || !canActOnNode(role, sel.acl)) return;
      updateNode(id, { x, y });
    },
    [nodes, role],
  );

  // Drag-creation state for rect/circle and freehand pen
  const dragState = useRef<{
    nodeId: string | null;
    startStage: { x: number; y: number };
    type: Tool;
  } | null>(null);

  /** Used for transformer anchor set + forceUpdate (must not reference `selectedNode` before it exists). */
  const selectedNodeKind = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)?.type
    : undefined;

  /* Keep handles in sync when switching text ↔ other shapes (anchor set changes). */
  useEffect(() => {
    transformerRef.current?.forceUpdate?.();
  }, [selectedNodeKind]);

  useEffect(() => {
    if (onStageReady && stageRef.current) {
      onStageReady(stageRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Konva Transformer — snap-to-node sizes (skips pen, locked/viewer) ── */
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr || isTransforming) return;

    const clear = () => {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    };

    if (tool !== 'select' || editingNodeId || !selectedNodeId) {
      clear();
      return;
    }

    const sel = nodes.find((n) => n.id === selectedNodeId);
    if (
      !sel ||
      sel.group_id ||
      sel.type === 'pen' ||
      sel.type === 'line' ||
      sel.type === 'arrow' ||
      !canActOnNode(role, sel.acl)
    ) {
      clear();
      return;
    }

    const g = groupRefs.current.get(selectedNodeId);
    if (g) {
      tr.nodes([g]);
      tr.getLayer()?.batchDraw();
    } else {
      clear();
    }
  }, [nodes, selectedNodeId, tool, editingNodeId, role, isTransforming]);

  function handleResizeStart() {
    setIsTransforming(true);
  }

  function handleResizeEnd() {
    const tr = transformerRef.current;
    const grp = tr?.nodes()[0] as Konva.Group | undefined;
    const snapshot = selectedNodeId
      ? nodes.find((n) => n.id === selectedNodeId)
      : undefined;
    if (grp && snapshot) commitGroupResize(grp, snapshot);
    setIsTransforming(false);
  }

  /* ── Resize observer — HTML container ───────────────────────────────── */
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
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'd' &&
        selectedNodeId
      ) {
        e.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (node && canActOnNode(role, node.acl)) {
          const nid = duplicateNode(selectedNodeId, userId);
          if (nid) setSelected(nid);
        }
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === ']' || e.key === '[') &&
        selectedNodeId
      ) {
        e.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (node && canActOnNode(role, node.acl)) {
          if (e.key === ']') layerBringForward(selectedNodeId);
          else layerSendBackward(selectedNodeId);
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        eraseNodeOrGroup(selectedNodeId);
      }
      if (e.key === 'Escape') {
        setSelected(null);
        setEditing(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, nodes, role, setSelected, setEditing, userId, eraseNodeOrGroup]);

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
  // Tracking happens on the wrapping <div> rather than on the Konva <Stage>
  // because Konva's pointer event dispatch is suppressed during stage-drag
  // (panning) and during shape drags. DOM-level mousemove always fires.
  const lastCursorAt = useRef(0);
  function onContainerMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const now = performance.now();
    if (now - lastCursorAt.current < CURSOR_THROTTLE_MS) return;
    lastCursorAt.current = now;

    const pos = toStageCoords(e.clientX, e.clientY);
    setLocalCursor(pos.x, pos.y);
    trackActivity(pos.x, pos.y, 1);

    handleCreationDrag(pos);
  }

  function onContainerMouseLeave() {
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
    trackActivity(pos.x, pos.y, 5);

    if (tool === 'select') {
      setSelected(null);
      setEditing(null);
      return;
    }

    if (tool === 'erase') {
      return;
    }

    if (tool === 'sticky' || tool === 'text') {
      const id = createNode({
        type: tool,
        x: pos.x,
        y: pos.y,
        author_id: userId,
        ...(tool === 'sticky' ? { fill: stickyDraftFill } : {}),
      });
      setSelected(id);
      // Auto-enter edit mode for fresh stickies / text blocks
      setEditing(id);
      // Snap back to select tool so the user isn't surprised next click
      setTool('select');
      return;
    }

    if (
      tool === 'rect' ||
      tool === 'round_rect' ||
      tool === 'circle' ||
      tool === 'pen' ||
      tool === 'line' ||
      tool === 'arrow'
    ) {
      const isPen = tool === 'pen';
      const isSeg = tool === 'line' || tool === 'arrow';
      const id = createNode({
        type: tool,
        x: pos.x,
        y: pos.y,
        width: isPen ? 0 : 1,
        height: isPen ? 0 : 1,
        points: isPen ? [0, 0] : isSeg ? [0, 0, Math.max(8, 1), 0] : [],
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

    if (drag.type === 'rect' || drag.type === 'round_rect' || drag.type === 'circle') {
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
    } else if (drag.type === 'line' || drag.type === 'arrow') {
      const sx = drag.startStage.x;
      const sy = drag.startStage.y;
      const ex = pos.x;
      const ey = pos.y;
      const x0 = Math.min(sx, ex);
      const y0 = Math.min(sy, ey);
      updateNode(drag.nodeId, {
        x: x0,
        y: y0,
        width: Math.max(8, Math.abs(ex - sx)),
        height: Math.max(8, Math.abs(ey - sy)),
        points: [sx - x0, sy - y0, ex - x0, ey - y0],
      });
    } else if (drag.type === 'pen') {
      const local = [pos.x - drag.startStage.x, pos.y - drag.startStage.y];
      appendPenPoints(drag.nodeId, local);
    }
  }

  function handleContainerMouseUp() {
    if (dragState.current) {
      const d = dragState.current;
      const id = d.nodeId;
      const t = d.type;

      // Read points from Yjs — React `nodes` can lag the last pointer sample, so
      // using snapshots here falsely deleted valid pen strokes as "too short".
      const yMap = id ? yjsNodesMap.get(id) : undefined;
      const livePoints =
        yMap instanceof Y.Map && Array.isArray(yMap.get('points'))
          ? (yMap.get('points') as number[])
          : null;

      if (id && t === 'pen') {
        if (livePoints && livePoints.length < 4) deleteNode(id);
      } else if (id && (t === 'line' || t === 'arrow')) {
        const p = livePoints;
        if (p && p.length >= 4) {
          const dx = (p[2] ?? 0) - (p[0] ?? 0);
          const dy = (p[3] ?? 0) - (p[1] ?? 0);
          if (dx * dx + dy * dy < 36) deleteNode(id);
        }
      }
      dragState.current = null;
    }
  }

  /* ── Stage drag (pan) handlers ──────────────────────────────────────── */
  function onStageDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    if (e.target !== stageRef.current) return;
    setStage({ x: e.target.x(), y: e.target.y() });
    const pos = stageRef.current.getPointerPosition();
    if (pos) {
      const stageCoords = toStageCoords(pos.x, pos.y);
      trackActivity(stageCoords.x, stageCoords.y, 2);
    }
  }

  /* ── Render helpers ─────────────────────────────────────────────────── */
  const editingNode = nodes.find((n) => n.id === editingNodeId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  const transformAnchors =
    selectedNode?.type === 'text' ? TRANSFORM_ANCHORS_HORIZONTAL : TRANSFORM_ANCHORS_ALL;

  const showResizeChrome = Boolean(
    selectedNode &&
      !selectedNode.group_id &&
      tool === 'select' &&
      !editingNodeId &&
      selectedNode.type !== 'pen' &&
      selectedNode.type !== 'line' &&
      selectedNode.type !== 'arrow' &&
      canActOnNode(role, selectedNode.acl),
  );

  // Stage is only draggable when in select mode — drawing tools want the drag
  const stageDraggable = tool === 'select' && !editingNodeId;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 dot-grid overflow-hidden"
      onMouseMove={onContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onMouseLeave={onContainerMouseLeave}
    >
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
        onDragMove={onStageDragMove}
        style={{
          cursor: stageDraggable ? 'grab' : tool === 'erase' ? 'cell' : 'crosshair',
        }}
      >
        <Layer>
          {nodes.map((node) => (
            <ShapeRenderer
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
              isEditing={node.id === editingNodeId}
              showResizeChrome={showResizeChrome && node.id === selectedNodeId}
              isTransforming={isTransforming}
              setGroupRef={setGroupRef}
              role={role}
              tool={tool}
              onSelect={(id) => setSelected(id)}
              onErase={eraseNodeOrGroup}
              onDoubleClick={(id) => setEditing(id)}
              onDragStart={handleShapeDragStart}
              onDragMove={handleShapeDragMove}
              onDragEnd={handleShapeDragEnd}
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            flipEnabled={false}
            enabledAnchors={transformAnchors}
            borderStroke="#4575f3"
            borderStrokeWidth={1}
            anchorStroke="#4575f3"
            anchorCornerRadius={2}
            anchorSize={11}
            padding={2}
            keepRatio={false}
            boundBoxFunc={(oldBox, newBox) => {
              const w = Math.max(newBox.width, 1);
              const h = Math.max(newBox.height, 1);
              if (w < MIN_RESIZE_W || h < MIN_RESIZE_H) return oldBox;
              return newBox;
            }}
            onTransformStart={handleResizeStart}
            onTransformEnd={handleResizeEnd}
          />
        </Layer>
      </Stage>

      <div className="pointer-events-none absolute left-3 top-3 z-[40]">
        <TemplateMenu
          role={role}
          userId={userId}
          stageCenterStage={() => ({
            x: (size.w / 2 - stagePos.x) / stageScale,
            y: (size.h / 2 - stagePos.y) / stageScale,
          })}
          onInserted={(ids) => {
            const last = ids[ids.length - 1];
            if (last) setSelected(last);
            setTool('select');
          }}
        />
      </div>

      {/* Layer + text / sticky formatting (bottom) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[35] flex flex-col items-center gap-2 px-2">
        {selectedNode && !editingNodeId && !selectedNode.group_id && (
          <SelectionLayerBar
            orderedNodes={nodes}
            node={selectedNode}
            role={role}
            userId={userId}
          />
        )}
        <NodeFormatBar node={selectedNode ?? null} role={role} />
      </div>

      {/* Minimap Overlay */}
      <Minimap 
        visible={heatmapVisible} 
        filter={heatmapFilter} 
        onJump={(x, y) => setStage({ x: -x * stageScale + size.w / 2, y: -y * stageScale + size.h / 2 })}
      />

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
    select: 'Drag to pan · Scroll to zoom · Templates ↑ · Pick a tool to start',
    sticky: 'Click anywhere to place a sticky note',
    text: 'Click anywhere to add text',
    rect: 'Click and drag to draw a rectangle',
    round_rect: 'Click and drag to draw a rounded rectangle',
    circle: 'Click and drag to draw an ellipse',
    pen: 'Click and drag to draw freehand',
    line: 'Click and drag for a straight line',
    arrow: 'Click and drag for an arrow',
    erase: 'Click or drag across shapes to erase',
  };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
      <p className="text-xs font-mono text-[var(--text-3)] uppercase tracking-widest">
        {hints[tool]}
      </p>
    </div>
  );
}
