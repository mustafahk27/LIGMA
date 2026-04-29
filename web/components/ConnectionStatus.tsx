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
      className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--surface-2)] flex-shrink-0"
      title={cfg.label}
      aria-label={cfg.label}
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{
          background: cfg.color,
          animation: cfg.pulse ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
        }}
      />
    </div>
  );
}
