'use client';

import { useWsStore } from '@/store/ws';

const STATUS_CONFIG = {
  connected:    { color: 'var(--success)', label: 'Connected',    pulse: false },
  reconnecting: { color: 'var(--warn)',    label: 'Reconnecting', pulse: true  },
  offline:      { color: 'var(--danger)',  label: 'Offline',      pulse: false },
} as const;

export function ConnectionStatus() {
  const status = useWsStore((s) => s.status);
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text-2)]"
      title={cfg.label}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: cfg.color,
          animation: cfg.pulse ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <span className="hidden sm:inline">{cfg.label}</span>
    </div>
  );
}
