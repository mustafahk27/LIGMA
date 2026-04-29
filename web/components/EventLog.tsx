'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ydoc } from '@/lib/yjs';
import { rooms, type AppEvent } from '@/lib/api';

interface EventLogProps { roomId: string; token: string; }

// ── Metadata ──────────────────────────────────────────────────────────────────

const META: Record<string, { color: string }> = {
  node_created: { color: '#34d399' },
  node_updated: { color: '#60a5fa' },
  node_deleted: { color: '#f87171' },
  node_locked:  { color: '#fbbf24' },
  node_unlocked:{ color: '#a78bfa' },
  task_assigned: { color: '#f59e0b' },
  task_status_changed: { color: '#22c55e' },
};

const TYPE_LABEL: Record<string, string> = {
  sticky:'sticky note', text:'text block', rect:'rectangle',
  round_rect:'rounded rect', circle:'circle', pen:'drawing',
  line:'line', arrow:'arrow',
};

function nodeTypeLabel(t?: unknown) { return TYPE_LABEL[String(t ?? '')] ?? 'node'; }

function shortStr(s: string, n = 22) {
  const c = s.trim();
  return c.length > n ? c.slice(0, n) + '…' : c;
}

function buildTitle(event: AppEvent): string {
  const p = event.payload as Record<string, unknown>;
  const type = nodeTypeLabel(p?.nodeType);
  const raw  = typeof p?.label === 'string' ? p.label.trim() : '';
  const lbl  = raw ? ` "${shortStr(raw)}"` : '';
  const nt   = String(p?.nodeType ?? '');

  switch (event.event_type) {
    case 'node_created':
      if (nt === 'pen')    return `Drew a drawing${lbl}`;
      if (nt === 'arrow')  return `Drew an arrow${lbl}`;
      if (nt === 'line')   return `Drew a line${lbl}`;
      if (nt === 'sticky') return `Added sticky note${lbl}`;
      if (nt === 'text')   return `Added text block${lbl}`;
      return `Created ${type}${lbl}`;
    case 'node_updated': return `Edited ${type}${lbl}`;
    case 'node_deleted': return `Deleted ${type}${lbl}`;
    case 'node_locked':  return `Locked ${type}${lbl}`;
    case 'node_unlocked':return `Unlocked ${type}${lbl}`;
    case 'task_assigned': {
      const assignee = typeof p?.assigneeName === 'string' ? p.assigneeName : 'someone';
      return `Assigned task${lbl} to ${assignee}`;
    }
    case 'task_status_changed': {
      const status = typeof p?.status === 'string' ? p.status.replace(/_/g, ' ') : 'updated';
      return `Marked task${lbl} as ${status}`;
    }
    default: return event.event_type.replace(/_/g, ' ');
  }
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function replayInterval(total: number) {
  if (total > 40) return 120;
  if (total > 20) return 200;
  if (total > 10) return 280;
  return 380;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function EventLog({ roomId, token }: EventLogProps) {
  const [events,      setEvents]      = useState<AppEvent[]>([]);
  const [replayQueue, setReplayQueue] = useState<AppEvent[]>([]);
  const [replayTotal, setReplayTotal] = useState(0);
  const [live,        setLive]        = useState(true);
  const [clearSeq,    setClearSeq]    = useState(0);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [tick,        setTick]        = useState(0);
  const [initLoading, setInitLoading] = useState(true);
  const [freshIds,    setFreshIds]    = useState<Set<string>>(new Set());

  const latestSeqRef = useRef(0);
  const newIds       = useRef<Set<string>>(new Set());
  const seqKey       = `eventlog_seq:${roomId}`;

  const clearKey = `eventlog_clear:${roomId}`;

  // ── Init: detect missed events and queue replay ────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setInitLoading(true);
      try {
        const storedStr = typeof window !== 'undefined' ? localStorage.getItem(seqKey) : '0';
        const stored = parseInt(storedStr ?? '0', 10);
        
        const storedClearStr = typeof window !== 'undefined' ? localStorage.getItem(clearKey) : '0';
        const initialClearSeq = parseInt(storedClearStr ?? '0', 10);
        if (!cancelled) setClearSeq(initialClearSeq);

        // Fetch up to 80 most recent events
        const data = await rooms.events(roomId, token, 0);
        if (cancelled) return;

        latestSeqRef.current = data.latest_seq;
        localStorage.setItem(seqKey, String(data.latest_seq));

        if (data.events.length === 0) return;

        if (stored > 0 && stored < data.latest_seq) {
          // Partition into seen (instant load) and missed (replay queue)
          const seen = data.events.filter(e => e.seq <= stored);
          const missed = data.events.filter(e => e.seq > stored);

          const seenIds = new Set(seen.map(e => e.id));
          newIds.current = seenIds;
          setFreshIds(seenIds);
          setEvents(seen);

          if (missed.length > 0) {
            const inOrder = [...missed].reverse();
            setReplayTotal(inOrder.length);
            setReplayQueue(inOrder);
          }
        } else {
          // Normal load (first time, or no missed events)
          const initialIds = new Set(data.events.map(e => e.id));
          newIds.current = initialIds;
          setFreshIds(initialIds);
          setEvents(data.events);
        }
      } catch { /* server not ready */ }
      finally {
        if (!cancelled) setInitLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  // ── Replay loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (replayQueue.length === 0) return;
    const delay = replayInterval(replayTotal);
    const id = setTimeout(() => {
      const [next, ...rest] = replayQueue;
      newIds.current = new Set([next.id]);
      setEvents(prev => {
        // Dedup — fetchIncremental can race with the replay tick when ydoc
        // updates fire from the canvas-replay flow, and React refuses to render
        // two children with the same key.
        if (prev.some(e => e.id === next.id)) return prev;
        return [next, ...prev].slice(0, 300);
      });
      setReplayQueue(rest);
    }, delay);
    return () => clearTimeout(id);
  }, [replayQueue, replayTotal]);

  // ── Incremental fetch on remote Yjs update ─────────────────────────────────

  const fetchIncremental = useCallback(async (): Promise<boolean> => {
    try {
      const data = await rooms.events(roomId, token, latestSeqRef.current);
      if (data.events.length === 0) return false;
      latestSeqRef.current = data.latest_seq;
      localStorage.setItem(seqKey, String(data.latest_seq));
      const freshIds = new Set(data.events.map(e => e.id));
      newIds.current = freshIds;
      setFreshIds(freshIds);
      setEvents(prev => {
        const existing = new Set(prev.map(e => e.id));
        const novel = data.events.filter(e => !existing.has(e.id));
        return [...novel, ...prev].slice(0, 300);
      });
      setLive(true);
      return true;
    } catch {
      return false;
    }
  }, [roomId, token, seqKey]);

  /**
   * After Yjs applies (local or remote), poll REST for new semantic rows. Short
   * debounce coalesces bursts; retries cover any straggling DB / network delay.
   */
  useEffect(() => {
    let debounceId: ReturnType<typeof setTimeout> | null = null;

    async function pullAfterRemoteFlush() {
      let got = await fetchIncremental();
      if (!got) {
        await new Promise((r) => setTimeout(r, 60));
        got = await fetchIncremental();
      }
      if (!got) {
        await new Promise((r) => setTimeout(r, 120));
        await fetchIncremental();
      }
    }

    function onUpdate(_u: Uint8Array, origin: unknown) {
      // Peers receive 'remote'; the editor does not (server skips echo), so also react to 'local'.
      if (origin !== 'remote' && origin !== 'local') return;
      if (debounceId !== null) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        debounceId = null;
        void pullAfterRemoteFlush();
      }, 40);
    }
    ydoc.on('update', onUpdate);
    return () => {
      if (debounceId !== null) clearTimeout(debounceId);
      ydoc.off('update', onUpdate);
    };
  }, [fetchIncremental]);

  // ── Timestamp ticker ───────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────

  const isReplaying = replayQueue.length > 0;
  const replayDone  = replayTotal - replayQueue.length;
  const visible     = events.filter(e => e.seq > clearSeq);

  const currentReplayEvent = isReplaying
    ? events[0] // the most recently surfaced one
    : null;

  function handleClear() {
    setClearSeq(latestSeqRef.current);
    if (typeof window !== 'undefined') {
      localStorage.setItem(clearKey, String(latestSeqRef.current));
    }
    setExpandedId(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

      {/* Replay banner */}
      {!initLoading && isReplaying && (
        <div
          className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--border)]"
          style={{ background: 'rgba(69,117,243,0.08)' }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-[var(--accent)] uppercase tracking-wider">
              ⏪ Replaying missed events
            </span>
            <span className="text-[10px] text-[var(--text-3)] font-mono">
              {replayDone} / {replayTotal}
            </span>
          </div>
          {/* Progress bar */}
          <div
            className="h-0.5 rounded-full w-full mb-1.5"
            style={{ background: 'var(--border)' }}
          >
            <div
              className="h-0.5 rounded-full transition-all duration-300"
              style={{
                width: `${(replayDone / replayTotal) * 100}%`,
                background: 'var(--accent)',
              }}
            />
          </div>
          {/* Current event label */}
          {currentReplayEvent && (
            <p className="text-[10px] text-[var(--text-2)] truncate">
              {buildTitle(currentReplayEvent)}
            </p>
          )}
        </div>
      )}

      {/* Header bar — hidden while initial fetch runs */}
      {!initLoading && (
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            {live && !isReplaying && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: 'var(--success)' }} />
            )}
            <span className="relative inline-flex rounded-full h-2 w-2"
              style={{ background: isReplaying ? 'var(--accent)' : live ? 'var(--success)' : 'var(--border-2)' }} />
          </span>
          <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
            {isReplaying ? 'Replaying…' : live ? 'Live' : 'Connecting…'}
          </span>
          <span className="ml-auto text-[10px] text-[var(--text-3)]">
            {visible.length > 0 ? `${visible.length}` : ''}
          </span>
          {visible.length > 0 && !isReplaying && (
            <button
              onClick={handleClear}
              title="Clear screen — new events still appear"
              style={{
                color: 'var(--text-3)', border: '1px solid var(--border)',
                background: 'transparent', cursor: 'pointer',
                fontSize: '9px', fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', padding: '2px 6px', borderRadius: '4px',
              }}
            >
              Clear
            </button>
          )}
      </div>
      )}

      {/* Event stream */}
      <div
        className={
          initLoading
            ? 'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4'
            : 'min-h-0 flex-1 overflow-y-auto'
        }
        role={initLoading ? 'status' : undefined}
        aria-label={initLoading ? 'Fetching room activity' : undefined}
      >
        {initLoading ? (
          <>
            <div
              className="h-8 w-8 shrink-0 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin"
              style={{ animationDuration: '0.7s' }}
              aria-hidden
            />
            <p className="max-w-[200px] text-center text-[10px] leading-relaxed text-[var(--text-3)]">
              Fetching room activity…
            </p>
          </>
        ) : visible.length === 0 && !isReplaying ? (
          <EmptyState cleared={clearSeq > 0} />
        ) : (
          <div className="flex flex-col">
            {visible.map(event => (
              <EventRow
                key={event.id}
                event={event}
                isNew={freshIds.has(event.id)}
                isExpanded={expandedId === event.id}
                onToggle={() => setExpandedId(p => p === event.id ? null : event.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EventRow ──────────────────────────────────────────────────────────────────

function EventRow({ event, isNew, isExpanded, onToggle }:
  { event: AppEvent; isNew: boolean; isExpanded: boolean; onToggle: () => void }) {

  const color = META[event.event_type]?.color ?? '#94a3b8';
  const title = buildTitle(event);
  const p     = event.payload as Record<string, unknown>;

  return (
    <div style={{ animation: isNew ? 'eventFlash 0.6s ease-out' : 'none' }}>
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-2 px-3 py-2.5 border-b border-[var(--border)] text-left transition-colors hover:bg-[var(--surface-2)]"
        style={{ background: isExpanded ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}
      >
        {/* Avatar */}
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 mt-0.5"
          style={{ background: event.actor_color }} title={event.actor_name}
        >
          {event.actor_name[0]?.toUpperCase() ?? '?'}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-[var(--text)] leading-tight">{title}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-[var(--text-3)]">{event.actor_name.split(' ')[0]}</span>
            <span className="text-[9px] font-semibold px-1 py-px rounded flex-shrink-0"
              style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
              {event.event_type.replace('node_', '')}
            </span>
            <span className="text-[10px] text-[var(--text-3)] ml-auto flex-shrink-0">
              {timeAgo(event.created_at)}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0 mt-1"
          style={{ color: 'var(--text-3)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Detail panel */}
      {isExpanded && (
        <div className="px-3 py-2.5 border-b border-[var(--border)] flex flex-col gap-1.5"
          style={{ background: 'var(--surface-3)' }}>
          <DetailRow label="Actor"   value={event.actor_name} color={event.actor_color} />
          <DetailRow label="Action"  value={event.event_type.replace(/_/g, ' ')} />
          <DetailRow label="Type"    value={nodeTypeLabel(p?.nodeType)} />
          {typeof p?.label === 'string' && p.label.trim() && (
            <DetailRow label="Content" value={`"${p.label.trim()}"`} />
          )}
          {typeof p?.nodeId === 'string' && (
            <DetailRow label="Node ID" value={p.nodeId} mono />
          )}
          <DetailRow label="Seq"  value={`#${event.seq}`} mono />
          <DetailRow label="Time" value={new Date(event.created_at).toLocaleTimeString()} />
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, color, mono }:
  { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-wider flex-shrink-0 w-14 pt-px"
        style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`text-[10px] break-all leading-tight ${mono ? 'font-mono' : ''}`}
        style={{ color: color ?? 'var(--text-2)' }}>{value}</span>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ cleared }: { cleared: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-3">
      <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center mb-3">
        {cleared
          ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8l4 4 6-8" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          : <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h8M2 12h5" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        }
      </div>
      <p className="text-xs text-[var(--text-3)] leading-relaxed">
        {cleared ? 'Screen cleared. New events will appear here.' : 'No events yet. Start editing the canvas.'}
      </p>
    </div>
  );
}
