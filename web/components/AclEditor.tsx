'use client';

import { setNodeAcl, deleteNode } from '@/lib/nodes';
import type { NodeSnapshot } from '@/lib/node-types';
import { nodeLocalContentBounds } from '@/lib/selection-bounds';
import { useUiStore } from '@/store/ui';

interface AclEditorProps {
  node: NodeSnapshot;
  stagePos: { x: number; y: number };
  stageScale: number;
}

/**
 * Floating control bar shown above a selected node when the local user is a
 * lead. Lets them lock / unlock the node and delete it. Lock state lives in
 * the node's `acl` field which the server-side RBAC layer reads on every
 * incoming Yjs update.
 */
export function AclEditor({ node, stagePos, stageScale }: AclEditorProps) {
  const setSelected = useUiStore((s) => s.setSelected);

  const b = nodeLocalContentBounds(node);
  const screenX = (node.x + b.x) * stageScale + stagePos.x;
  const screenY = (node.y + b.y) * stageScale + stagePos.y;

  function toggleLock() {
    setNodeAcl(node.id, { locked: !node.acl.locked });
  }

  function handleDelete() {
    deleteNode(node.id);
    setSelected(null);
  }

  return (
    <div
      className="absolute flex items-center gap-1 px-1.5 py-1 rounded-lg shadow-lg"
      style={{
        left: screenX,
        top: screenY - 38,
        background: 'var(--surface)',
        border: '1px solid var(--border-2)',
        zIndex: 30,
      }}
    >
      <button
        onClick={toggleLock}
        className="text-xs px-2 py-1 rounded-md flex items-center gap-1 transition-colors"
        style={{
          background: node.acl.locked ? 'rgba(251,191,36,0.15)' : 'transparent',
          color: node.acl.locked ? '#fbbf24' : 'var(--text-2)',
        }}
        title={node.acl.locked ? 'Unlock — anyone can edit' : 'Lock — only leads can edit'}
      >
        {node.acl.locked ? (
          <>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 5V3.5a2 2 0 014 0V5" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Locked
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 5V3.5a2 2 0 013.6-1.2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            Unlocked
          </>
        )}
      </button>
      <div className="w-px h-4 bg-[var(--border)]" />
      <button
        onClick={handleDelete}
        className="text-xs px-2 py-1 rounded-md text-[var(--text-2)] hover:text-[var(--danger)] hover:bg-[rgba(242,87,87,0.1)] transition-colors flex items-center gap-1"
        title="Delete (Del / Backspace)"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 3h7M5 3V2h2v1M3.5 3l.5 7h4l.5-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Delete
      </button>
    </div>
  );
}
