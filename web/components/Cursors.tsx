'use client';

import { useEffect, useState } from 'react';
import { awareness } from '@/lib/ws-provider';
import type { AwarenessState } from '@/lib/awareness-identity';

interface CursorsProps {
  stagePos: { x: number; y: number };
  stageScale: number;
}

interface RemoteCursor {
  clientId: number;
  identity: NonNullable<AwarenessState['identity']>;
  cursor: NonNullable<AwarenessState['cursor']>;
}

/**
 * Renders other users' cursors as absolutely positioned divs over the canvas.
 * Cursor positions are received in **stage** coordinates so we re-project them
 * through the stage transform on every render.
 */
export function Cursors({ stagePos, stageScale }: CursorsProps) {
  const [remotes, setRemotes] = useState<RemoteCursor[]>([]);

  useEffect(() => {
    function pull() {
      const states = awareness.getStates() as Map<number, AwarenessState>;
      const list: RemoteCursor[] = [];
      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // skip self
        if (!state || !state.identity || !state.cursor) return;
        list.push({
          clientId,
          identity: state.identity,
          cursor: state.cursor,
        });
      });
      setRemotes(list);
    }

    pull();
    awareness.on('change', pull);
    return () => {
      awareness.off('change', pull);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {remotes.map((r) => {
        const screenX = r.cursor.x * stageScale + stagePos.x;
        const screenY = r.cursor.y * stageScale + stagePos.y;
        return (
          <CursorDot
            key={r.clientId}
            x={screenX}
            y={screenY}
            color={r.identity.color}
            name={r.identity.name}
          />
        );
      })}
    </div>
  );
}

function CursorDot({
  x,
  y,
  color,
  name,
}: {
  x: number;
  y: number;
  color: string;
  name: string;
}) {
  return (
    <div
      className="absolute"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        // smooth small jitters between throttled updates without dragging far behind
        transition: 'transform 80ms linear',
        willChange: 'transform',
      }}
    >
      {/* Arrow */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
      >
        <path
          d="M2 2 L2 14 L6 10.5 L9 16 L11 15 L8.5 10 L13 9 Z"
          fill={color}
          stroke="#0c1020"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>

      {/* Label */}
      <span
        className="absolute top-3 left-4 text-[10px] font-medium px-1.5 py-0.5 rounded text-white whitespace-nowrap"
        style={{
          background: color,
          boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
        }}
      >
        {name}
      </span>
    </div>
  );
}
