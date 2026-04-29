'use client';

import { useMemo, useState } from 'react';
import type { TaskKind, TaskStatus } from '@/lib/node-types';

export interface TaskItem {
  id: string;
  nodeId: string;
  text: string;
  authorName: string;
  authorColor: string;
  createdAt: string;
  status: TaskStatus;
  kind: TaskKind;
  assigneeId?: string | null;
  response?: string;
}

type RoomMember = { id: string; name: string; color: string; role: string };

interface TaskUpdatePatch {
  status?: TaskStatus;
  assigneeId?: string | null;
  response?: string;
}

interface TaskBoardProps {
  items: TaskItem[];
  members: RoomMember[];
  currentUserId: string;
  onJump?: (id: string) => void;
  onUpdateTask?: (nodeId: string, todoId: string, patch: TaskUpdatePatch) => void;
}

export function TaskBoard({ items, members, currentUserId, onJump, onUpdateTask }: TaskBoardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);

  const memberList = useMemo(() => members, [members]);

  return (
    <div
      className="flex flex-col border-l border-[var(--border)] bg-[var(--surface)] transition-all duration-200 flex-shrink-0"
      style={{ width: collapsed ? '40px' : '280px' }}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)] flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="var(--accent)" />
              <rect x="8" y="1" width="5" height="5" rx="1" fill="var(--border-2)" />
              <rect x="1" y="8" width="5" height="5" rx="1" fill="var(--border-2)" />
              <rect x="8" y="8" width="5" height="5" rx="1" fill="var(--violet)" />
            </svg>
            <span className="text-xs font-semibold text-[var(--text)] uppercase tracking-wider truncate">
              Task Board
            </span>
            {items.length > 0 && (
              <span className="text-[10px] bg-[var(--accent)] text-white rounded-full px-1.5 py-0.5 font-semibold flex-shrink-0">
                {items.length}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          title={collapsed ? 'Expand task board' : 'Collapse task board'}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {items.length === 0 ? (
            <EmptyTaskBoard />
          ) : (
            items.map((item, i) => (
              <TaskCard
                key={item.id}
                item={item}
                members={memberList}
                currentUserId={currentUserId}
                onJump={onJump}
                onEdit={() => setEditing(item)}
                delay={i * 0.04}
              />
            ))
          )}
        </div>
      )}

      {editing && onUpdateTask && (
        <TaskEditor
          item={editing}
          members={memberList}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            onUpdateTask(editing.nodeId, editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EmptyTaskBoard() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-10 text-center px-2">
      <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center mb-3">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M3 5h12M3 9h8M3 13h5"
            stroke="var(--text-3)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        Tasks and open questions will appear here as your team writes them
      </p>
    </div>
  );
}

function TaskCard({
  item,
  members,
  currentUserId,
  onJump,
  onEdit,
  delay,
}: {
  item: TaskItem;
  members: RoomMember[];
  currentUserId: string;
  onJump?: (id: string) => void;
  onEdit: () => void;
  delay: number;
}) {
  const snippet = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
  const timeAgo = formatTimeAgo(item.createdAt);
  const initial = item.authorName[0]?.toUpperCase() ?? '?';
  const assignee = members.find((m) => m.id === item.assigneeId);
  const assigneeLabel = assignee ? (assignee.id === currentUserId ? 'You' : assignee.name) : 'Unassigned';

  return (
    <div
      className="card p-3 flex flex-col gap-2 animate-slide-right hover:border-[var(--border-2)] transition-colors group"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="text-xs text-[var(--text)] leading-relaxed font-medium">{snippet}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider bg-[var(--surface-2)] text-[var(--text-3)]">
              {item.kind === 'open_question' ? 'Question' : 'Task'}
            </span>
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{
                background:
                  item.status === 'closed'
                    ? 'var(--text-3)'
                    : item.status === 'completed'
                      ? 'var(--success)'
                      : item.status === 'inprogress'
                        ? '#f59e0b'
                        : '#1d4ed8',
                color: '#fff',
                boxShadow:
                  item.status === 'inprogress'
                    ? '0 0 0 1px rgba(245,158,11,0.35)'
                    : item.status === 'open'
                      ? '0 0 0 1px rgba(29,78,216,0.35)'
                      : 'none',
              }}
            >
              {item.status.replace(/_/g, ' ')}
            </span>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider bg-[var(--surface-2)] text-[var(--text-3)]">
              {assigneeLabel}
            </span>
          </div>
          {item.kind === 'open_question' && item.response?.trim() && (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-2)] border-l-2 border-[var(--border)] pl-2">
              {item.response}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="text-[10px] font-semibold px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
          >
            Edit
          </button>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider" style={{
            background: item.kind === 'open_question' ? 'rgba(251,191,36,0.18)' : 'rgba(69,117,243,0.12)',
            color: item.kind === 'open_question' ? '#b45309' : 'var(--accent)'
          }}>
            {item.kind === 'open_question' ? 'Question' : 'Task'}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: item.authorColor }}
            title={item.authorName}
          >
            {initial}
          </div>
          <span className="text-[11px] text-[var(--text-3)] truncate max-w-[80px]">
            {item.authorName}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-3)]">{timeAgo}</span>

          {onJump && (
            <button
              onClick={() => onJump(item.nodeId)}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
              title="Jump to node"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 5h8M5 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskEditor({
  item,
  members,
  currentUserId,
  onClose,
  onSave,
}: {
  item: TaskItem;
  members: RoomMember[];
  currentUserId: string;
  onClose: () => void;
  onSave: (patch: TaskUpdatePatch) => void;
}) {
  const [status, setStatus] = useState<TaskStatus>(item.status);
  const [assigneeId, setAssigneeId] = useState<string>(item.assigneeId ?? '');
  const [response, setResponse] = useState(item.response ?? '');
  const needsResponse = item.kind === 'open_question' && status !== 'open';

  function handleSave() {
    if (needsResponse && !response.trim()) return;
    onSave({
      status,
      assigneeId: assigneeId || null,
      response: response.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Task</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--text)] leading-snug">{item.text}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-3)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-1.5">Assignee</span>
            <select
              className="input"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.id === currentUserId ? 'You' : member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-1.5">Status</span>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              <option value="open">Open</option>
              <option value="inprogress">In progress</option>
              <option value="completed">Completed</option>
              <option value="closed">Closed</option>
            </select>
          </label>

          {item.kind === 'open_question' && (
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-1.5">
                Answer or description
              </span>
              <textarea
                className="input min-h-[96px] resize-y"
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Add an answer before closing the question"
              />
              {needsResponse && !response.trim() && (
                <p className="mt-1 text-[11px] text-[var(--danger)]">Open question tasks need an answer before the status changes.</p>
              )}
            </label>
          )}
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={needsResponse && !response.trim()}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
