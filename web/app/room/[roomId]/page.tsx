'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { useUiStore, type Tool } from '@/store/ui';
import { useWsStore } from '@/store/ws';
import { rooms } from '@/lib/api';
import type { Room } from '@/lib/api';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { TaskBoard } from '@/components/TaskBoard';
import type { TaskItem } from '@/components/TaskBoard';
import { useWsProvider } from '@/lib/ws-provider';
import { setLocalIdentity, clearLocalAwareness } from '@/lib/awareness-identity';
import type { Role } from '@/lib/node-types';

/* Konva needs `window` — defer the entire Canvas to client-only */
const Canvas = dynamic(() => import('@/components/Canvas'), {
  ssr: false,
  loading: () => <CanvasFallback />,
});

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

const DEMO_TASKS: TaskItem[] = [];

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ roomId: string | string[] }>();
  const roomId = useMemo(() => {
    const raw = params.roomId;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw[0] ?? '';
    return '';
  }, [params.roomId]);

  const { user, token, hydrate, hydrated } = useAuthStore();

  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const setRole = useUiStore((s) => s.setRole);

  const [room, setRoom] = useState<Room | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'contributor' | 'viewer'>('contributor');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');
  const [rejection, setRejection] = useState<string | null>(null);

  /* ── Auth bootstrap ─────────────────────────────────────────────────── */
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!roomId) return;
    loadRoom();
  }, [hydrated, token, roomId]);

  /* ── Compute role + memoise so identity doesn't churn ───────────────── */
  const myRole: Role = useMemo(() => {
    return (room?.members?.find((m) => m.id === user?.id)?.role as Role) ?? 'viewer';
  }, [room, user]);

  const isLead = myRole === 'lead';

  useEffect(() => {
    setRole(myRole);
  }, [myRole, setRole]);

  /* ── Connect Yjs WS provider once room + user are known ─────────────── */
  useWsProvider(roomId, token);

  /* ── Push our identity into Awareness so other tabs label cursors ───── */
  useEffect(() => {
    if (!user || !room) return;
    setLocalIdentity({
      id: user.id,
      name: user.name,
      color: user.color,
      role: myRole,
    });
    return () => {
      clearLocalAwareness();
    };
  }, [user, room, myRole]);

  /* ── Watch for RBAC rejections and surface them as a toast ──────────── */
  useEffect(() => {
    function onRejected(e: Event) {
      const detail = (e as CustomEvent<{ reason: string; nodeId?: string }>).detail;
      setRejection(detail?.reason ?? 'Update rejected');
      setTimeout(() => setRejection(null), 3000);
    }
    window.addEventListener('ligma:rejected', onRejected as EventListener);
    return () => window.removeEventListener('ligma:rejected', onRejected as EventListener);
  }, []);

  /* ── Tool keyboard shortcuts ────────────────────────────────────────── */
  useEffect(() => {
    const map: Record<string, Tool> = {
      v: 'select', s: 'sticky', t: 'text', r: 'rect', c: 'circle', p: 'pen',
    };
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const next = map[e.key.toLowerCase()];
      if (next) setTool(next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

  async function loadRoom() {
    if (!token || !roomId) return;
    try {
      const r = await rooms.get(roomId, token);
      setRoom(r);
    } catch {
      // not a member or room gone
    } finally {
      setLoadingRoom(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !roomId) return;
    setInviteStatus('sending');
    setInviteError('');
    try {
      const { invites } = await import('@/lib/api');
      await invites.create(roomId, inviteEmail, inviteRole, token);
      setInviteStatus('sent');
      setInviteEmail('');
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite');
      setInviteStatus('error');
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] flex-shrink-0 z-40"
        style={{ background: 'var(--bg)', minHeight: '48px' }}
      >
        <Link
          href="/dashboard"
          className="text-sm font-bold tracking-widest uppercase font-mono text-[var(--text-2)] hover:text-[var(--text)] transition-colors flex-shrink-0"
          style={{ letterSpacing: '0.15em' }}
        >
          LIGMA
        </Link>

        <span className="text-[var(--border-2)] text-sm flex-shrink-0">/</span>

        <span className="text-sm font-medium text-[var(--text)] truncate">
          {loadingRoom ? (
            <span className="inline-block w-24 h-3.5 bg-[var(--surface-2)] rounded animate-pulse" />
          ) : (
            room?.name ?? 'Unknown Room'
          )}
        </span>

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

        {/* Tools — disabled for viewers */}
        <div
          className="flex items-center gap-0.5 mx-2 p-1 rounded-lg bg-[var(--surface)] border border-[var(--border)]"
          style={{ opacity: myRole === 'viewer' ? 0.5 : 1 }}
        >
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.label}
              disabled={myRole === 'viewer' && t.id !== 'select'}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-all disabled:cursor-not-allowed"
              style={{
                background: tool === t.id ? 'var(--accent)' : 'transparent',
                color: tool === t.id ? '#fff' : 'var(--text-3)',
              }}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="flex-1" />

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
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 relative overflow-hidden">
          {user && room && !loadingRoom && (
            <Canvas userId={user.id} role={myRole} />
          )}
        </div>

        <TaskBoard items={DEMO_TASKS} onJump={(id) => console.log('jump to', id)} />

        {/* RBAC rejection toast */}
        {rejection && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg text-xs font-medium animate-fade-in"
            style={{
              background: 'rgba(242,87,87,0.95)',
              color: '#fff',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              zIndex: 50,
            }}
          >
            🚫 {rejection}
          </div>
        )}
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

function CanvasFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center dot-grid">
      <p className="text-xs font-mono text-[var(--text-3)] uppercase tracking-widest">
        Loading canvas…
      </p>
    </div>
  );
}
