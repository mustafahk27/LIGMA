'use client';

import {
  duplicateNode,
  layerBringForward,
  layerBringToFront,
  layerSendBackward,
  layerSendToBack,
} from '@/lib/nodes';
import { canActOnNode } from '@/lib/node-types';
import type { NodeSnapshot, Role } from '@/lib/node-types';
import { useUiStore } from '@/store/ui';

interface SelectionLayerBarProps {
  orderedNodes: NodeSnapshot[];
  node: NodeSnapshot;
  role: Role;
  userId: string;
}

/**
 * Duplicate + layer stacking for the selected node (bottom toolbar strip).
 */
export function SelectionLayerBar({
  orderedNodes,
  node,
  role,
  userId,
}: SelectionLayerBarProps) {
  const setSelected = useUiStore((s) => s.setSelected);

  if (!canActOnNode(role, node.acl)) return null;

  const idx = orderedNodes.findIndex((n) => n.id === node.id);
  if (idx < 0) return null;
  const canForward = idx >= 0 && idx < orderedNodes.length - 1;
  const canBackward = idx > 0;

  function onDuplicate() {
    const id = duplicateNode(node.id, userId);
    if (id) setSelected(id);
  }

  return (
    <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] hidden sm:inline mr-0.5">
        Layer
      </span>

      <button
        type="button"
        className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-35 disabled:cursor-not-allowed border border-transparent hover:border-[var(--border)]"
        title="Send to back"
        disabled={idx <= 0}
        onClick={() => layerSendToBack(node.id)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 4h10M8 13V4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-35 disabled:cursor-not-allowed border border-transparent hover:border-[var(--border)]"
        title="Backward"
        disabled={!canBackward}
        onClick={() => layerSendBackward(node.id)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M5 13V6M5 13l10-10"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-35 disabled:cursor-not-allowed border border-transparent hover:border-[var(--border)]"
        title="Forward"
        disabled={!canForward}
        onClick={() => layerBringForward(node.id)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M11 3v7M11 3L1 13"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-35 disabled:cursor-not-allowed border border-transparent hover:border-[var(--border)]"
        title="Bring to front"
        disabled={idx >= orderedNodes.length - 1}
        onClick={() => layerBringToFront(node.id)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 12h10M8 3v9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="w-px h-5 bg-[var(--border)] mx-0.5 hidden sm:block" />

      <button
        type="button"
        className="h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--border)]"
        title="Duplicate (Ctrl+D)"
        onClick={onDuplicate}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M9 11H4a1 1 0 01-1-1V6M7 11V6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M4 10V8a4 4 0 018 0v2M4 3h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        Duplicate
      </button>
    </div>
  );
}
