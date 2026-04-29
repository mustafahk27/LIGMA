'use client';

import { setNodeAcl, deleteNode } from '@/lib/nodes';
import type { NodeSnapshot } from '@/lib/node-types';
import { nodeLocalContentBounds } from '@/lib/selection-bounds';
import { useUiStore } from '@/store/ui';

interface Member {
  id: string;
  name: string;
  color: string;
  role: string;
}

interface AclEditorProps {
  node: NodeSnapshot;
  stagePos: { x: number; y: number };
  stageScale: number;
  members?: Member[];
  userId?: string;
}

/**
 * Floating control bar shown above a selected node when the local user is a
 * lead. Lets them lock / unlock the node, block/unblock specific users, and
 * delete it. Lock state and blockedUsers live in the node's `acl` field which
 * the server-side RBAC layer reads on every incoming Yjs update.
 */
export function AclEditor({ node, stagePos, stageScale, members = [], userId }: AclEditorProps) {
  const setSelected = useUiStore((s) => s.setSelected);

  const b = nodeLocalContentBounds(node);
  const screenX = (node.x + b.x) * stageScale + stagePos.x;
  const screenY = (node.y + b.y) * stageScale + stagePos.y;

  const blockedUsers: string[] = node.acl.blockedUsers ?? [];

  // Only show non-lead members as candidates for blocking (leads always retain access)
  const blockableMembers = members.filter((m) => m.id !== userId && m.role !== 'lead');

  function toggleLock() {
    setNodeAcl(node.id, { locked: !node.acl.locked, blockedUsers });
  }

  function toggleBlock(memberId: string) {
    const next = blockedUsers.includes(memberId)
      ? blockedUsers.filter((id) => id !== memberId)
      : [...blockedUsers, memberId];
    setNodeAcl(node.id, { locked: node.acl.locked, blockedUsers: next });
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

      {/* Per-user block toggles */}
      {blockableMembers.length > 0 && (
        <>
          <div className="w-px h-4 bg-[var(--border)]" />
          <span className="text-[10px] text-[var(--text-3)] select-none">Block:</span>
          <div className="flex items-center gap-0.5">
            {blockableMembers.map((m) => {
              const isBlocked = blockedUsers.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggleBlock(m.id)}
                  className="relative flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold transition-all"
                  style={{
                    background: m.color,
                    opacity: isBlocked ? 1 : 0.85,
                    outline: isBlocked ? '2px solid #ef4444' : 'none',
                    outlineOffset: '1px',
                  }}
                  title={isBlocked ? `Unblock ${m.name}` : `Block ${m.name} from editing`}
                >
                  {m.name.charAt(0).toUpperCase()}
                  {isBlocked && (
                    <span
                      className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-2.5 h-2.5 rounded-full bg-red-500 text-white"
                      style={{ fontSize: 7, lineHeight: 1 }}
                    >
                      ✕
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

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
