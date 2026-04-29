'use client';

import { useWsStore } from '@/store/ws';

/**
 * Top-of-canvas banner shown while we're replaying missed Yjs updates after a
 * reconnect. Driven by `replay` state in the WS store, which the provider
 * advances tick-by-tick as each update is applied.
 */
export function CanvasReplayOverlay() {
  const replay = useWsStore((s) => s.replay);
  if (!replay.active && replay.done === 0) return null;
  if (!replay.active) return null;

  const pct = replay.total > 0 ? (replay.done / replay.total) * 100 : 0;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-3 z-[45] -translate-x-1/2"
      style={{ minWidth: '260px', maxWidth: '90%' }}
    >
      <div
        className="flex flex-col gap-1.5 rounded-lg border px-3 py-2 backdrop-blur-md"
        style={{
          background: 'rgba(69,117,243,0.12)',
          borderColor: 'rgba(69,117,243,0.35)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            ⏪ Replaying missed changes
          </span>
          <span className="font-mono text-[10px] text-[var(--text-2)]">
            {replay.done} / {replay.total}
          </span>
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{ width: `${pct}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>
    </div>
  );
}
