'use client';

import { useState } from 'react';

export interface TaskItem {
  id: string;
  text: string;
  authorName: string;
  authorColor: string;
  createdAt: string; // ISO string
}

interface TaskBoardProps {
  items: TaskItem[];
  onJump?: (id: string) => void;
}

export function TaskBoard({ items, onJump }: TaskBoardProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="flex flex-col border-l border-[var(--border)] bg-[var(--surface)] transition-all duration-200 flex-shrink-0"
      style={{ width: collapsed ? '40px' : '280px' }}
    >
      {/* Header */}
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

      {/* Body */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {items.length === 0 ? (
            <EmptyTaskBoard />
          ) : (
            items.map((item, i) => (
              <TaskCard
                key={item.id}
                item={item}
                onJump={onJump}
                delay={i * 0.04}
              />
            ))
          )}
        </div>
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
        Action items will appear here as your team writes them
      </p>
    </div>
  );
}

function TaskCard({
  item,
  onJump,
  delay,
}: {
  item: TaskItem;
  onJump?: (id: string) => void;
  delay: number;
}) {
  const snippet = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
  const timeAgo = formatTimeAgo(item.createdAt);
  const initial = item.authorName[0]?.toUpperCase() ?? '?';

  return (
    <div
      className="card p-3 flex flex-col gap-2 animate-slide-right hover:border-[var(--border-2)] transition-colors group"
      style={{ animationDelay: `${delay}s` }}
    >
      {/* Text */}
      <p className="text-xs text-[var(--text)] leading-relaxed font-medium">{snippet}</p>

      {/* Footer */}
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
              onClick={() => onJump(item.id)}
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

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
