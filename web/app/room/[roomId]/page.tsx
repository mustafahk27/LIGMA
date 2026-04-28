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

const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  {
    id: 'select',
    label: 'Select (V)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 2l4.5 11 2-4.5L13 6.5 2 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'sticky',
    label: 'Sticky Note (S)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 5h6M4 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'text',
    label: 'Text (T)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 3h10M7 3v8M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'rect',
    label: 'Rectangle (R)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    id: 'circle',
    label: 'Circle (C)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    id: 'pen',
    label: 'Pen (P)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 12L9.5 4.5a2 2 0 012.8 2.8L4.8 14.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M9 5l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
];

// Demo task items — will be replaced by live Yjs data in Feature 11
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

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    loadRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, token]);

  // Keyboard shortcuts for tools
  useEffect(() => {
    const map: Record<string, Tool> = {
      v: 'select', s: 'sticky', t: 'text', r: 'rect', c: 'circle', p: 'pen',
    };
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
      // room not found or no access
    } finally {
      setLoadingRoom(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
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
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] flex-shrink-0 z-40"
        style={{ background: 'var(--bg)', minHeight: '48px' }}
      >
        {/* Logo / back */}
        <Link
          href="/dashboard"
          className="text-sm font-bold tracking-widest uppercase font-mono text-[var(--text-2)] hover:text-[var(--text)] transition-colors flex-shrink-0"
          style={{ letterSpacing: '0.15em' }}
        >
          LIGMA
        </Link>

        <span className="text-[var(--border-2)] text-sm flex-shrink-0">/</span>

        {/* Room name */}
        <span className="text-sm font-medium text-[var(--text)] truncate">
          {loadingRoom ? (
            <span className="inline-block w-24 h-3.5 bg-[var(--surface-2)] rounded animate-pulse" />
          ) : (
            room?.name ?? 'Unknown Room'
          )}
        </span>

        {/* Role badge */}
        {!loadingRoom && room && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0"
            style={{
              background: isLead ? 'rgba(69,117,243,0.15)' : 'var(--surface-2)',
              color: isLead ? 'var(--accent)' : 'var(--text-3)',
              border: `1px solid ${isLead ? 'rgba(69,117,243,0.3)' : 'var(--border)'}`,
            }}
          >
            {myRole}
          </span>
        )}

        {/* Tools */}
        <div className="flex items-center gap-0.5 mx-2 p-1 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={tool.label}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-all"
              style={{
                background: activeTool === tool.id ? 'var(--accent)' : 'transparent',
                color: activeTool === tool.id ? '#fff' : 'var(--text-3)',
              }}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Member avatars */}
        {!loadingRoom && room && (
          <div className="flex -space-x-1.5 mr-2">
            {(room.members ?? []).slice(0, 5).map((m) => (
              <div
                key={m.id}
                className="w-6 h-6 rounded-full border border-[var(--bg)] flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                style={{ background: m.color }}
                title={`${m.name} (${m.role})`}
              >
                {m.name[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        )}

        {/* Invite button (lead only) */}
        {isLead && (
          <button
            className="btn btn-ghost text-xs px-2.5 py-1 flex-shrink-0"
            onClick={() => { setShowInviteModal(true); setInviteStatus('idle'); }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Invite
          </button>
        )}

        <ConnectionStatus />
      </header>

      {/* ── Canvas + TaskBoard ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden dot-grid">
          <CanvasPlaceholder tool={activeTool} />
        </div>

        {/* Task Board drawer */}
        <TaskBoard items={DEMO_TASKS} onJump={(id) => console.log('jump to', id)} />
      </div>

      {/* ── Invite modal ────────────────────────────────────────────── */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6 animate-fade-in shadow-2xl">
            <h2 className="text-base font-semibold text-[var(--text)] mb-1">
              Invite to {room?.name}
            </h2>
            <p className="text-xs text-[var(--text-2)] mb-4">
              Send an invite link by email. Invites expire after 48 hours.
            </p>

            {inviteStatus === 'sent' ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-10 h-10 rounded-full bg-[var(--success)]/15 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9l5 5 7-8" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-sm text-[var(--text)]">Invite sent!</p>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => { setShowInviteModal(false); setInviteStatus('idle'); }}
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5 uppercase tracking-wider">
                    Email
                  </label>
                  <input
                    className="input"
                    type="email"
                    placeholder="teammate@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5 uppercase tracking-wider">
                    Role
                  </label>
                  <div className="flex gap-2">
                    {(['contributor', 'viewer'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setInviteRole(r)}
                        className="flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-all capitalize"
                        style={{
                          background: inviteRole === r ? 'var(--accent)' : 'var(--surface-2)',
                          color: inviteRole === r ? '#fff' : 'var(--text-2)',
                          borderColor: inviteRole === r ? 'var(--accent)' : 'var(--border)',
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {inviteStatus === 'error' && (
                  <p className="text-sm text-[var(--danger)]">{inviteError}</p>
                )}

                <div className="flex gap-2 mt-1">
                  <button
                    type="submit"
                    className="btn btn-primary flex-1"
                    disabled={inviteStatus === 'sending'}
                  >
                    {inviteStatus === 'sending' ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Sending…
                      </>
                    ) : (
                      'Send Invite'
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost flex-1"
                    onClick={() => setShowInviteModal(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CanvasPlaceholder({ tool }: { tool: Tool }) {
  const hints: Record<Tool, string> = {
    select:  'Click to select elements',
    sticky:  'Double-click anywhere to place a sticky note',
    text:    'Click to place a text block',
    rect:    'Click and drag to draw a rectangle',
    circle:  'Click and drag to draw a circle',
    pen:     'Click and drag to draw freehand',
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
      {/* Crosshair center */}
      <div className="relative flex items-center justify-center">
        <div className="absolute w-px h-12 bg-[var(--border)]" />
        <div className="absolute w-12 h-px bg-[var(--border)]" />
        <div className="w-2 h-2 rounded-full bg-[var(--border-2)]" />
      </div>

      <p className="mt-8 text-xs font-mono text-[var(--text-3)] uppercase tracking-widest">
        {hints[tool]}
      </p>
      <p className="mt-2 text-xs text-[var(--text-3)]">
        Canvas initialises here (Feature 4)
      </p>
    </div>
  );
}
