'use client';

import { useState } from 'react';
import type Konva from 'konva';
import * as Y from 'yjs';
import { nodes as yjsNodesMap } from '@/lib/yjs';

interface Props {
  stageRef: React.RefObject<Konva.Stage | null>;
  roomId: string;
  roomName: string;
  token: string;
  /** Custom trigger renderer — receives an `open` callback. Falls back to a default button. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}

type Mode = 'narrative' | 'structured';

/**
 * Temporarily transforms the Konva Layer to fit all nodes into the viewport,
 * captures a PNG via stage.toDataURL, then restores the original transform.
 * Returns raw base64 (no data-URL prefix) or null if canvas is empty.
 */
function captureFullCanvas(stage: Konva.Stage): string | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const [, nodeMap] of yjsNodesMap) {
    if (!(nodeMap instanceof Y.Map)) continue;
    const x = (nodeMap.get('x') as number) ?? 0;
    const y = (nodeMap.get('y') as number) ?? 0;
    const w = (nodeMap.get('width') as number) ?? 100;
    const h = (nodeMap.get('height') as number) ?? 100;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  if (!isFinite(minX)) return null;

  const padding = 60;
  const contentW = maxX - minX + padding * 2;
  const contentH = maxY - minY + padding * 2;
  const stageW = stage.width();
  const stageH = stage.height();
  const scale = Math.min(stageW / contentW, stageH / contentH);

  // Pan/zoom is on the Stage itself (scaleX/x props), not the Layer.
  // Save stage transform, apply fit-to-all, capture, restore.
  const origScaleX = stage.scaleX();
  const origScaleY = stage.scaleY();
  const origX = stage.x();
  const origY = stage.y();

  const offsetX = (stageW - contentW * scale) / 2;
  const offsetY = (stageH - contentH * scale) / 2;

  stage.scaleX(scale);
  stage.scaleY(scale);
  stage.x(offsetX - (minX - padding) * scale);
  stage.y(offsetY - (minY - padding) * scale);
  stage.batchDraw();

  const dataUrl = stage.toDataURL({ pixelRatio: 2 });

  // Restore
  stage.scaleX(origScaleX);
  stage.scaleY(origScaleY);
  stage.x(origX);
  stage.y(origY);
  stage.batchDraw();

  // Strip the data-URL prefix — server wants raw base64
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

export function ExportButton({ stageRef, roomId, roomName, token, renderTrigger }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('narrative');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);

    try {
      let image: string | null = null;
      if (stageRef.current) {
        image = captureFullCanvas(stageRef.current);
        // Drop oversized images (>8MB base64) to avoid 413
        if (image && image.length > 8 * 1024 * 1024) image = null;
      }

      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${apiBase}/rooms/${roomId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode, image }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${roomName.replace(/[^a-z0-9]/gi, '_')}_Summary.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }

  const openDialog = () => { setOpen(true); setError(null); };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openDialog)
      ) : (
        <button
          className="btn btn-ghost text-xs px-2.5 py-1 flex-shrink-0"
          onClick={openDialog}
          title="Export Summary"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M6 1v7M3 5l3 3 3-3M1 9v1.5A.5.5 0 001.5 11h9a.5.5 0 00.5-.5V9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Export
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6 animate-fade-in shadow-2xl">
            <h2 className="text-base font-semibold text-[var(--text)] mb-1">
              Export Summary
            </h2>
            <p className="text-xs text-[var(--text-2)] mb-4">
              Choose a format for your AI-generated session brief.
            </p>

            <div className="flex flex-col gap-2 mb-5">
              {([
                {
                  value: 'narrative' as Mode,
                  label: 'Narrative',
                  desc: 'Prose summary written by AI — readable by anyone.',
                },
                {
                  value: 'structured' as Mode,
                  label: 'Structured Sections',
                  desc: 'Decisions / Action Items / Open Questions grouped by type.',
                },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className="flex items-start gap-3 p-3 rounded-lg border text-left transition-all"
                  style={{
                    background: mode === opt.value ? 'rgba(69,117,243,0.08)' : 'var(--surface-2)',
                    borderColor: mode === opt.value ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <span
                    className="mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0"
                    style={{
                      borderColor: mode === opt.value ? 'var(--accent)' : 'var(--text-3)',
                      background: mode === opt.value ? 'var(--accent)' : 'transparent',
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium text-[var(--text)]">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-[var(--text-2)] mt-0.5">
                      {opt.desc}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {error && (
              <p className="text-xs text-[var(--danger)] mb-3">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={handleExport}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Generating…
                  </>
                ) : (
                  'Export PDF'
                )}
              </button>
              <button
                type="button"
                className="btn btn-ghost flex-1"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
