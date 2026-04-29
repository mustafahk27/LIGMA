'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { rooms } from '@/lib/api';
import type { Room } from '@/lib/api';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { TaskBoard } from '@/components/TaskBoard';
import type { TaskItem } from '@/components/TaskBoard';

type Tool = 'select' | 'sticky' | 'text' | 'rect' | 'circle' | 'pen';

const TOOLS: { id: Tool; label: string; shortcut: string; icon: React.ReactNode }[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 2l4.5 11 2-4.5L13 6.5 2 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'sticky',
    label: 'Sticky',
    shortcut: 'S',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 5h6M4 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'text',
    label: 'Text',
    shortcut: 'T',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 3h10M7 3v8M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'rect',
    label: 'Rect',
    shortcut: 'R',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    id: 'circle',
    label: 'Circle',
    shortcut: 'C',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    id: 'pen',
    label: 'Pen',
    shortcut: 'P',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 12L9.5 4.5a2 2 0 012.8 2.8L4.8 14.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M9 5l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
];

const DEMO_TASKS: TaskItem[] = [];

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const { user, token, hydrate, hydrated } = useAuthStore();

  const [room, setRoom] = useState<Room | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'contributor' | 'viewer'>('contributor');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) { router.replace('/login'); return; }
    loadRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, token]);

  useEffect(() => {
    const map: Record<string, Tool> = { v: 'select', s: 'sticky', t: 'text', r: 'rect', c: 'circle', p: 'pen' };
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const tool = map[e.key.toLowerCase()];
      if (tool) setActiveTool(tool);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function loadRoom() {
    if (!token || !params.roomId) return;
    try {
      const r = await rooms.get(params.roomId, token);
      setRoom(r);
    } catch {
      // no access
    } finally {
      setLoadingRoom(false);
    }
  }

  async function handleInvite(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!token || !params.roomId) return;
    setInviteStatus('sending');
    setInviteError('');
    try {
      const { invites } = await import('@/lib/api');
      await invites.create(params.roomId, inviteEmail, inviteRole, token);
      setInviteStatus('sent');
      setInviteEmail('');
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite');
      setInviteStatus('error');
    }
  }

  const myRole = room?.members?.find((m) => m.id === user?.id)?.role ?? 'viewer';
  const isLead = myRole === 'lead';

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-5 flex-shrink-0 z-40"
        style={{
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          height: '44px',
        }}
      >
        {/* Breadcrumb */}
        <Link
          href="/dashboard"
          className="font-mono text-[9px] tracking-[0.4em] uppercase transition-colors"
          style={{ color: 'var(--text-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
        >
          LIGMA
        </Link>

        <span style={{ color: 'var(--border-2)' }}>/</span>

        <span className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
          {loadingRoom ? (
            <span className="inline-block w-20 h-3 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
          ) : (
            room?.name ?? 'Unknown Room'
          )}
        </span>

        {!loadingRoom && room && (
          <span
            className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 flex-shrink-0"
            style={{
              color: isLead ? 'var(--accent)' : 'var(--text-3)',
              border: `1px solid ${isLead ? 'rgba(69,117,243,0.35)' : 'var(--border)'}`,
              borderRadius: '2px',
            }}
          >
            {myRole}
          </span>
        )}

        <div className="flex-1" />

        {/* Member avatars */}
        {!loadingRoom && room && (
          <div className="flex -space-x-1.5">
            {(room.members ?? []).slice(0, 5).map((m) => (
              <div
                key={m.id}
                title={`${m.name} · ${m.role}`}
                className="w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                style={{ background: m.color, borderColor: 'var(--bg)' }}
              >
                {m.name[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {/* Invite (lead only) */}
        {isLead && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors flex-shrink-0"
            style={{
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
              borderRadius: '3px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
            onClick={() => { setShowInviteModal(true); setInviteStatus('idle'); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Invite
          </button>
        )}

        <ConnectionStatus />
      </header>

      {/* ── Canvas + Sidebar ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden dot-grid">

          {/* Floating vertical toolbar */}
          <div
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-0.5 p-1.5"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                title={`${tool.label} (${tool.shortcut})`}
                className="w-8 h-8 flex items-center justify-center transition-all"
                style={{
                  background: activeTool === tool.id ? 'var(--accent)' : 'transparent',
                  color: activeTool === tool.id ? '#fff' : 'var(--text-3)',
                  borderRadius: '6px',
                }}
                onMouseEnter={(e) => {
                  if (activeTool !== tool.id)
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                }}
                onMouseLeave={(e) => {
                  if (activeTool !== tool.id)
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
                }}
              >
                {tool.icon}
              </button>
            ))}

            {/* Divider */}
            <div className="h-px my-0.5" style={{ background: 'var(--border)' }} />

            {/* Shortcut hint */}
            <div
              className="w-8 flex items-center justify-center"
              style={{ color: 'var(--text-3)' }}
              title="Use keyboard shortcuts: V S T R C P"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="0.5" y="0.5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1" />
                <path d="M3 7.5l2-4 2 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          <CanvasPlaceholder tool={activeTool} />
        </div>

        {/* Task Board */}
        <TaskBoard items={DEMO_TASKS} onJump={(id) => console.log('jump to', id)} />
      </div>

      {/* ── Invite modal ─────────────────────────────────────────────── */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
          <div
            className="w-full max-w-sm p-8 animate-fade-in"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
            }}
          >
            {inviteStatus === 'sent' ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div
                  className="w-10 h-10 flex items-center justify-center"
                  style={{ background: 'rgba(52,211,153,0.1)', borderRadius: '8px' }}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9l5 5 7-8" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Invite sent</p>
                <button
                  className="text-xs"
                  style={{ color: 'var(--text-3)' }}
                  onClick={() => { setShowInviteModal(false); setInviteStatus('idle'); }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.25em] mb-2"
                  style={{ color: 'var(--text-3)' }}
                >
                  Invite to room
                </p>
                <h2 className="text-xl font-bold mb-8" style={{ color: 'var(--text)' }}>
                  {room?.name}
                </h2>

                <form onSubmit={handleInvite} className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2.5">
                    <label
                      className="text-[10px] font-semibold uppercase tracking-[0.25em]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      Email
                    </label>
                    <input
                      className="input-line"
                      type="email"
                      placeholder="teammate@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label
                      className="text-[10px] font-semibold uppercase tracking-[0.25em]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      Role
                    </label>
                    <div className="flex gap-2">
                      {(['contributor', 'viewer'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setInviteRole(r)}
                          className="flex-1 py-2 text-xs font-medium capitalize transition-all"
                          style={{
                            background: inviteRole === r ? 'var(--accent)' : 'var(--surface-2)',
                            color: inviteRole === r ? '#fff' : 'var(--text-2)',
                            border: `1px solid ${inviteRole === r ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: '3px',
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {inviteStatus === 'error' && (
                    <p className="text-xs" style={{ color: 'var(--danger)' }}>{inviteError}</p>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={inviteStatus === 'sending'}
                      className="flex-1 py-2.5 text-sm font-semibold tracking-[0.05em] transition-opacity disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: '#fff', borderRadius: '3px' }}
                    >
                      {inviteStatus === 'sending' ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Sending…
                        </span>
                      ) : 'Send Invite'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowInviteModal(false)}
                      className="flex-1 py-2.5 text-sm"
                      style={{
                        background: 'var(--surface-2)',
                        color: 'var(--text-2)',
                        border: '1px solid var(--border)',
                        borderRadius: '3px',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CanvasPlaceholder({ tool }: { tool: Tool }) {
  const hints: Record<Tool, string> = {
    select: 'Click to select · Drag to move',
    sticky: 'Double-click anywhere to place a sticky note',
    text:   'Click anywhere to place a text block',
    rect:   'Click and drag to draw a rectangle',
    circle: 'Click and drag to draw a circle',
    pen:    'Draw freehand anywhere on the canvas',
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center select-none pointer-events-none">
      <p
        className="font-mono text-[11px] tracking-[0.2em] uppercase"
        style={{ color: 'var(--text-3)' }}
      >
        {hints[tool]}
      </p>
    </div>
  );
}
