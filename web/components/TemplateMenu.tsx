'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CANVAS_TEMPLATE_LIST,
  insertCanvasTemplate,
  type CanvasTemplateId,
} from '@/lib/canvas-templates';
import type { Role } from '@/lib/node-types';

interface TemplateMenuProps {
  role: Role;
  userId: string;
  /** Current visible center of the stage in canvas (world) coordinates. */
  stageCenterStage: () => { x: number; y: number };
  onInserted: (ids: string[]) => void;
}

/**
 * Premade layouts (retro, SWOT, flow, mind map, standup) — drops at viewport center.
 */
export function TemplateMenu({
  role,
  userId,
  stageCenterStage,
  onInserted,
}: TemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  if (role === 'viewer') return null;

  function choose(id: CanvasTemplateId) {
    const anchor = stageCenterStage();
    const ids = insertCanvasTemplate(id, userId, anchor);
    onInserted(ids);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative pointer-events-auto">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors shadow-sm"
        onClick={() => setOpen((v) => !v)}
        title="Insert a template"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M7 3v8M10 10H9a2 2 0 00-4 0H4M3 3h8a2 2 0 012 2v5a3 3 0 003 3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 11V8a5 5 0 019.9-1"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <span className="hidden sm:inline">Templates</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-[60] mt-1.5 max-h-[min(70vh,360px)] w-[min(calc(100vw-24px),280px)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1.5 shadow-xl"
          role="menu"
        >
          {CANVAS_TEMPLATE_LIST.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              className="w-full px-3 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors"
              onClick={() => choose(t.id)}
            >
              <div className="text-xs font-semibold text-[var(--text)]">{t.title}</div>
              <div className="text-[11px] text-[var(--text-2)] mt-0.5 leading-snug">{t.blurb}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
