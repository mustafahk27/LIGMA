'use client';

import { updateNode } from '@/lib/nodes';
import {
  STICKY_PALETTE,
  FONT_SIZE_OPTIONS,
  type NodeSnapshot,
  type Role,
} from '@/lib/node-types';
import { canActOnNode } from '@/lib/node-types';
import { useUiStore } from '@/store/ui';

interface NodeFormatBarProps {
  node: NodeSnapshot | null;
  role: Role;
}

/**
 * Bottom pill for sticky (fill + text) and text-node formatting. Uses
 * `onMouseDown` + `preventDefault` on toggles so textarea can stay focused.
 */
export function NodeFormatBar({ node, role }: NodeFormatBarProps) {
  const setStickyDraftFill = useUiStore((s) => s.setStickyDraftFill);

  if (!node) return null;
  if (node.type !== 'sticky' && node.type !== 'text') return null;
  if (!canActOnNode(role, node.acl)) return null;

  const sizeOptions = [...new Set([...FONT_SIZE_OPTIONS, node.fontSize])].sort((a, b) => a - b);

  function patch(p: Partial<Pick<NodeSnapshot, 'fill' | 'fontSize' | 'textColor' | 'fontBold' | 'fontItalic' | 'textUnderline'>>) {
    updateNode(node.id, p);
    if ('fill' in p && p.fill && node.type === 'sticky') {
      setStickyDraftFill(p.fill as string);
    }
  }

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg max-w-[min(100%,560px)]">
      {node.type === 'sticky' && (
        <div className="flex items-center gap-1.5 border-r border-[var(--border)] pr-3 mr-0.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] whitespace-nowrap hidden sm:inline">
            Sticky
          </span>
          {STICKY_PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              className="w-6 h-6 rounded-md border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{
                background: hex,
                borderColor: node.fill === hex ? 'var(--accent)' : 'rgba(0,0,0,0.12)',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => patch({ fill: hex })}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-3)] uppercase tracking-wider">
          Size
          <select
            className="text-xs font-mono bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text)] min-w-[52px]"
            value={node.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
          >
            {sizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Text color</span>
          <input
            type="color"
            className="w-7 h-7 rounded cursor-pointer border border-[var(--border)] bg-transparent"
            value={normalizeHex(node.textColor)}
            onChange={(e) => patch({ textColor: e.target.value })}
            title="Text color"
          />
        </label>

        <span className="w-px h-5 bg-[var(--border)] hidden sm:block" />

        <ToggleBtn
          active={node.fontBold}
          label="Bold"
          onToggle={() => patch({ fontBold: !node.fontBold })}
        />
        <ToggleBtn
          active={node.fontItalic}
          label="Italic"
          onToggle={() => patch({ fontItalic: !node.fontItalic })}
        />
        <ToggleBtn
          active={node.textUnderline}
          label="Underline"
          onToggle={() => patch({ textUnderline: !node.textUnderline })}
        />
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs font-semibold border transition-colors ${
        active
          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
          : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]'
      }`}
    >
      {label === 'Bold' && 'B'}
      {label === 'Italic' && 'I'}
      {label === 'Underline' && 'U'}
    </button>
  );
}

/** Coerce to #rrggbb for `<input type="color">` (best effort). */
function normalizeHex(c: string): string {
  const t = c.trim();
  if (/^#[\da-f]{6}$/i.test(t)) return t;
  if (/^#[\da-f]{3}$/i.test(t)) {
    const r = t[1]!;
    const g = t[2]!;
    const b = t[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#1c1917';
}
