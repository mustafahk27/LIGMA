'use client';

/**
 * Decorative canvas preview shown on the right side of auth pages.
 * Pure CSS animation — no canvas library loaded yet.
 */
export function CanvasPreview() {
  return (
    <div className="absolute inset-0 flex items-center justify-center select-none overflow-hidden">
      {/* Radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 60% 50%, rgba(69,117,243,0.07) 0%, transparent 70%)',
        }}
      />

      {/* Floating sticky notes */}
      <div className="relative w-[520px] h-[420px]">
        {/* Note A — yellow, action item */}
        <StickyNote
          style={{ top: 30, left: 40 }}
          color="#fde68a"
          animation="animate-float-a"
          delay="0s"
          tag="action_item"
          lines={['TODO: deploy to Render', 'before demo starts']}
          cursor={{ name: 'Alex', color: '#818cf8' }}
        />

        {/* Note B — blue, decision */}
        <StickyNote
          style={{ top: 150, left: 240 }}
          color="#93c5fd"
          animation="animate-float-b"
          delay="1.2s"
          tag="decision"
          lines={['Use Yjs for CRDT', '— agreed ✓']}
        />

        {/* Note C — green, open question */}
        <StickyNote
          style={{ top: 240, left: 40 }}
          color="#86efac"
          animation="animate-float-c"
          delay="0.6s"
          tag="open_question"
          lines={['How do we handle', 'offline edits?']}
          cursor={{ name: 'Sam', color: '#f87171' }}
        />

        {/* Note D — purple, reference */}
        <StickyNote
          style={{ top: 60, left: 310 }}
          color="#c4b5fd"
          animation="animate-float-a"
          delay="2s"
          tag="reference"
          lines={['[ref] y-protocols', 'awareness docs']}
        />

        {/* Note E — pink */}
        <StickyNote
          style={{ top: 310, left: 200 }}
          color="#fca5a5"
          animation="animate-float-b"
          delay="3.5s"
          tag="action_item"
          lines={['TODO: write tests', 'for RBAC layer']}
        />

        {/* Connector lines (decorative) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-20"
          style={{ zIndex: 0 }}
        >
          <line x1="160" y1="90" x2="240" y2="175" stroke="#4575f3" strokeWidth="1" strokeDasharray="4 4" />
          <line x1="340" y1="120" x2="310" y2="185" stroke="#8b5cf6" strokeWidth="1" strokeDasharray="4 4" />
          <line x1="160" y1="290" x2="200" y2="340" stroke="#4575f3" strokeWidth="1" strokeDasharray="4 4" />
        </svg>
      </div>

      {/* Bottom label */}
      <div className="absolute bottom-8 left-0 right-0 text-center">
        <p className="text-xs font-mono text-[var(--text-3)] uppercase tracking-[0.2em]">
          Real-time · AI-powered · Collaborative
        </p>
      </div>
    </div>
  );
}

interface StickyNoteProps {
  style: React.CSSProperties;
  color: string;
  animation: string;
  delay: string;
  tag: 'action_item' | 'decision' | 'open_question' | 'reference';
  lines: string[];
  cursor?: { name: string; color: string };
}

const TAG_LABELS: Record<StickyNoteProps['tag'], string> = {
  action_item:   'action item',
  decision:      'decision',
  open_question: 'open question',
  reference:     'reference',
};

function StickyNote({ style, color, animation, delay, tag, lines, cursor }: StickyNoteProps) {
  return (
    <div
      className={`absolute ${animation} z-10`}
      style={{ ...style, animationDelay: delay }}
    >
      <div
        className="w-[160px] rounded-lg shadow-xl p-3 flex flex-col gap-1.5"
        style={{ background: color }}
      >
        {/* Tag badge */}
        <span
          className="self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
          style={{ background: 'rgba(0,0,0,0.15)', color: 'rgba(0,0,0,0.65)' }}
        >
          {TAG_LABELS[tag]}
        </span>

        {/* Text */}
        {lines.map((line, i) => (
          <p key={i} className="text-xs font-medium leading-snug" style={{ color: 'rgba(0,0,0,0.75)' }}>
            {line}
          </p>
        ))}

        {/* Cursor badge */}
        {cursor && (
          <div className="flex items-center gap-1 mt-1">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: cursor.color }}
            />
            <span className="text-[10px]" style={{ color: 'rgba(0,0,0,0.5)' }}>
              {cursor.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
