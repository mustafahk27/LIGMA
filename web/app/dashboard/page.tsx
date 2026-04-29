'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { auth, dashboard, rooms } from '@/lib/api';
import type { Room, RoomDashboardRoom, UserDashboardRoom, UserDashboardSummary } from '@/lib/api';

type ViewMode = 'user' | 'room';

export default function DashboardPage() {
  const router = useRouter();
  const { user, token, hydrate, hydrated, clearAuth } = useAuthStore();

  const [view, setView] = useState<ViewMode>('user');
  const [roomList, setRoomList] = useState<Room[]>([]);
  const [userSummary, setUserSummary] = useState<UserDashboardSummary | null>(null);
  const [userRooms, setUserRooms] = useState<UserDashboardRoom[]>([]);
  const [roomStats, setRoomStats] = useState<RoomDashboardRoom[]>([]);

  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState('');

  const [creating, setCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    void loadAll(token);
  }, [hydrated, token, router]);

  async function loadAll(activeToken: string) {
    setLoadingRooms(true);
    setLoadingStats(true);
    setStatsError('');

    try {
      const [list, userData, roomData] = await Promise.all([
        rooms.list(activeToken),
        dashboard.user(activeToken),
        dashboard.rooms(activeToken),
      ]);

      setRoomList(list);
      setUserSummary(userData.summary);
      setUserRooms(userData.rooms);
      setRoomStats(roomData.rooms);
    } catch (err: unknown) {
      setStatsError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoadingRooms(false);
      setLoadingStats(false);
    }
  }

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!token || !newRoomName.trim()) return;

    setCreating(true);
    setCreateError('');
    try {
      const room = await rooms.create(newRoomName.trim(), token);
      setNewRoomName('');
      setShowCreate(false);
      await loadAll(token);
      router.push(`/room/${room.id}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  }

  async function handleLogout() {
    if (token) {
      try {
        await auth.logout(token);
      } catch {
        // ignore logout errors
      }
    }
    clearAuth();
    router.push('/login');
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  const highlight = useMemo(() => {
    if (!userSummary) {
      return {
        totalRooms: 0,
        missedUpdates: 0,
        openTasks: 0,
      };
    }

    return {
      totalRooms: userSummary.total_rooms,
      missedUpdates: userSummary.total_missed_updates,
      openTasks: userSummary.assigned_open_to_me,
    };
  }, [userSummary]);

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] sticky top-0 z-50"
        style={{ background: 'var(--bg)' }}
      >
        <span
          className="text-lg font-bold tracking-widest uppercase font-mono text-[var(--text)]"
          style={{ letterSpacing: '0.18em' }}
        >
          LIGMA
        </span>

        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
            style={{ background: user?.color ?? 'var(--accent)' }}
            title={user?.name}
          >
            {initials}
          </div>
          <span className="text-sm text-[var(--text-2)] hidden sm:block">{user?.name}</span>

          <button
            onClick={handleLogout}
            className="btn btn-ghost text-xs px-3 py-1.5"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 sm:py-10">
        <section
          className="relative overflow-hidden rounded-2xl border border-[var(--border)] p-6 sm:p-7 mb-6"
          style={{
            background:
              'radial-gradient(130% 120% at 8% 0%, rgba(69,117,243,0.22), rgba(12,16,32,1) 45%), radial-gradient(100% 90% at 100% 100%, rgba(139,92,246,0.18), rgba(12,16,32,0) 55%), var(--surface)',
          }}
        >
          <div className="absolute -right-16 -top-20 w-56 h-56 rounded-full blur-3xl" style={{ background: 'var(--accent-glow)' }} />
          <div className="absolute -left-12 -bottom-20 w-52 h-52 rounded-full blur-3xl" style={{ background: 'var(--violet-glow)' }} />

          <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-3)] font-semibold">Workspace Insights</p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-[var(--text)]">Command Center</h1>
              <p className="mt-2 text-sm text-[var(--text-2)] max-w-xl">
                Track missed room updates, assigned tasks, and delivery progress across your collaboration spaces.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 min-w-[280px]">
              <StatPill label="Rooms" value={highlight.totalRooms} />
              <StatPill label="Missed" value={highlight.missedUpdates} danger={highlight.missedUpdates > 0} />
              <StatPill label="My Open" value={highlight.openTasks} warn={highlight.openTasks > 0} />
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Select Dashboard</span>
            <div className="inline-flex items-center rounded-xl border border-[var(--border-2)] bg-[var(--surface)] p-1.5 shadow-[0_0_0_1px_rgba(69,117,243,0.12)]">
            <button
              className="px-4 py-2 text-xs font-semibold rounded-lg transition-colors"
              style={{
                color: view === 'user' ? '#fff' : 'var(--text-3)',
                background: view === 'user' ? 'var(--accent)' : 'transparent',
              }}
              onClick={() => setView('user')}
            >
              User Dashboard
            </button>
            <button
              className="px-4 py-2 text-xs font-semibold rounded-lg transition-colors"
              style={{
                color: view === 'room' ? '#fff' : 'var(--text-3)',
                background: view === 'room' ? 'var(--accent)' : 'transparent',
              }}
              onClick={() => setView('room')}
            >
              Room Dashboard
            </button>
          </div>
          </div>

          <div className="flex-1" />

          <button
            className="btn btn-primary"
            onClick={() => {
              setShowCreate(true);
              setCreateError('');
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New Room
          </button>
        </div>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="card w-full max-w-sm p-6 animate-fade-in shadow-2xl">
              <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Create Room</h2>
              <form onSubmit={handleCreateRoom} className="flex flex-col gap-3">
                <input
                  className="input"
                  type="text"
                  placeholder="Room name"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  required
                  autoFocus
                />
                {createError && (
                  <p className="text-sm text-[var(--danger)]">{createError}</p>
                )}
                <div className="flex gap-2 mt-1">
                  <button type="submit" className="btn btn-primary flex-1" disabled={creating}>
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost flex-1"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {statsError && (
          <div className="card px-4 py-3 mb-5 text-sm text-[var(--danger)]">
            {statsError}
          </div>
        )}

        {loadingStats || loadingRooms ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card h-32 animate-pulse" />
            ))}
          </div>
        ) : view === 'user' ? (
          <UserDashboardView
            summary={userSummary}
            rows={userRooms}
            roomList={roomList}
          />
        ) : (
          <RoomDashboardView
            rows={roomStats}
          />
        )}
      </main>
    </div>
  );
}

function StatPill({
  label,
  value,
  danger = false,
  warn = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border px-3 py-2" style={{
      borderColor: danger ? 'rgba(242,87,87,0.45)' : warn ? 'rgba(251,191,36,0.45)' : 'var(--border)',
      background: danger ? 'rgba(242,87,87,0.12)' : warn ? 'rgba(251,191,36,0.12)' : 'rgba(12,16,32,0.45)',
    }}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function UserDashboardView({
  summary,
  rows,
  roomList,
}: {
  summary: UserDashboardSummary | null;
  rows: UserDashboardRoom[];
  roomList: Room[];
}) {
  if (!summary) {
    return <div className="card px-4 py-6 text-sm text-[var(--text-2)]">No user dashboard data yet.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard title="Total Rooms" value={summary.total_rooms} subtitle="rooms you can access" />
        <MetricCard title="Missed Updates" value={summary.total_missed_updates} subtitle="updates since last visit" tone="danger" />
        <MetricCard title="Assigned Tasks" value={summary.assigned_to_me} subtitle="all assigned tasks" tone="accent" />
        <MetricCard title="Open for You" value={summary.assigned_open_to_me} subtitle="open + in-progress" tone="warn" />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text)]">Room Activity Radar</h2>
          <span className="text-[11px] text-[var(--text-3)]">sorted by missed updates</span>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-sm text-[var(--text-2)]">No rooms yet. Create one to start tracking activity.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((row) => {
              const room = roomList.find((r) => r.id === row.room_id);
              const completion = row.total_tasks > 0 ? Math.round(((row.completed_tasks + row.closed_tasks) / row.total_tasks) * 100) : 0;
              return (
                <Link key={row.room_id} href={`/room/${row.room_id}`} className="block px-4 py-3 hover:bg-[var(--surface-2)] transition-colors">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{row.room_name}</p>
                      <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                        {row.member_count} members • {row.total_tasks} tasks • completion {completion}%
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <TinyChip label="Missed" value={row.missed_updates} tone={row.missed_updates > 0 ? 'danger' : 'neutral'} />
                      <TinyChip label="Assigned" value={row.assigned_to_me} tone="accent" />
                      <TinyChip label="Open" value={row.assigned_open_to_me} tone={row.assigned_open_to_me > 0 ? 'warn' : 'neutral'} />
                      {room && (
                        <div className="flex -space-x-1.5 ml-1">
                          {room.members.slice(0, 3).map((member) => (
                            <div
                              key={member.id}
                              className="w-5 h-5 rounded-full border border-[var(--surface)] text-[9px] text-white font-bold flex items-center justify-center"
                              style={{ background: member.color }}
                              title={member.name}
                            >
                              {member.name[0]?.toUpperCase()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomDashboardView({ rows }: { rows: RoomDashboardRoom[] }) {
  if (rows.length === 0) {
    return <div className="card px-4 py-6 text-sm text-[var(--text-2)]">No room stats yet.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {rows.map((row) => (
        <Link key={row.room_id} href={`/room/${row.room_id}`}>
          <div className="card p-4 hover:border-[var(--border-2)] hover:bg-[var(--surface-2)] transition-colors h-full">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text)]">{row.room_name}</h3>
                <p className="text-[11px] text-[var(--text-3)] mt-0.5">{row.member_count} users</p>
              </div>
              <span className="text-[11px] font-semibold px-2 py-1 rounded-md" style={{
                background: row.missed_updates > 0 ? 'rgba(251,191,36,0.16)' : 'rgba(52,211,153,0.15)',
                color: row.missed_updates > 0 ? '#d97706' : 'var(--success)',
              }}>
                {row.missed_updates > 0 ? `${row.missed_updates} unread` : 'up to date'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <MiniStat label="Total Tasks" value={row.total_tasks} />
              <MiniStat label="Completed" value={row.completed_tasks + row.closed_tasks} />
              <MiniStat label="In Progress" value={row.inprogress_tasks} />
              <MiniStat label="Open" value={row.open_tasks} />
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-[var(--text-3)]">Task completion</span>
                <span className="text-[11px] font-semibold text-[var(--text)]">{row.completion_rate}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${row.completion_rate}%`,
                    background: 'linear-gradient(90deg, var(--accent), var(--success))',
                  }}
                />
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  tone = 'neutral',
}: {
  title: string;
  value: number;
  subtitle: string;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger';
}) {
  const style = {
    neutral: {
      borderColor: 'var(--border)',
      background: 'var(--surface)',
      value: 'var(--text)',
    },
    accent: {
      borderColor: 'rgba(69,117,243,0.35)',
      background: 'rgba(69,117,243,0.12)',
      value: 'var(--accent)',
    },
    warn: {
      borderColor: 'rgba(251,191,36,0.35)',
      background: 'rgba(251,191,36,0.12)',
      value: '#d97706',
    },
    danger: {
      borderColor: 'rgba(242,87,87,0.35)',
      background: 'rgba(242,87,87,0.12)',
      value: '#ef4444',
    },
  }[tone];

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: style.borderColor, background: style.background }}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold">{title}</p>
      <p className="text-2xl font-semibold mt-1" style={{ color: style.value }}>{value}</p>
      <p className="text-[11px] text-[var(--text-3)] mt-0.5">{subtitle}</p>
    </div>
  );
}

function TinyChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'accent' | 'warn' | 'danger';
}) {
  const palette = {
    neutral: { bg: 'var(--surface)', fg: 'var(--text-2)', border: 'var(--border)' },
    accent: { bg: 'rgba(69,117,243,0.14)', fg: 'var(--accent)', border: 'rgba(69,117,243,0.28)' },
    warn: { bg: 'rgba(251,191,36,0.16)', fg: '#d97706', border: 'rgba(251,191,36,0.28)' },
    danger: { bg: 'rgba(242,87,87,0.14)', fg: '#ef4444', border: 'rgba(242,87,87,0.28)' },
  }[tone];

  return (
    <span className="text-[10px] font-semibold rounded px-2 py-1 border" style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }}>
      {label}: {value}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-[var(--text)] mt-0.5">{value}</p>
    </div>
  );
}
