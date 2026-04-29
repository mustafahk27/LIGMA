'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { auth, rooms } from '@/lib/api';
import type { Room } from '@/lib/api';

export default function Root() {
  const router = useRouter();
  const { user, token, hydrate, hydrated, clearAuth } = useAuthStore();

  const [roomList, setRoomList] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (token) {
      void loadRooms(token);
    } else {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  async function loadRooms(activeToken: string) {
    setLoadingRooms(true);
    try {
      const list = await rooms.list(activeToken);
      setRoomList(list);
    } finally {
      setLoadingRooms(false);
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
      await loadRooms(token);
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

  const initials = useMemo(() => {
    if (!user?.name) return '??';
    return user.name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [user?.name]);

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
          <Link href="/dashboard" className="btn btn-ghost text-xs px-3 py-1.5">
            Dashboard
          </Link>

          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
            style={{ background: user?.color ?? 'var(--accent)' }}
            title={user?.name}
          >
            {initials}
          </div>
          <span className="text-sm text-[var(--text-2)] hidden sm:block">{user?.name}</span>

          <button onClick={handleLogout} className="btn btn-ghost text-xs px-3 py-1.5">
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
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-3)] font-semibold">Home</p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-[var(--text)]">Your Rooms</h1>
              <p className="mt-2 text-sm text-[var(--text-2)] max-w-xl">
                Jump straight into a room. Open the dashboard only when you need the slower summary view.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
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
              <Link href="/dashboard" className="btn btn-ghost">
                Open Dashboard
              </Link>
            </div>
          </div>
        </section>

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
                {createError && <p className="text-sm text-[var(--danger)]">{createError}</p>}
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

        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text)]">Rooms</h2>
            <span className="text-[11px] text-[var(--text-3)]">{loadingRooms ? 'loading…' : `${roomList.length} total`}</span>
          </div>

          {loadingRooms ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card h-28 animate-pulse" />
              ))}
            </div>
          ) : roomList.length === 0 ? (
            <div className="p-6 text-sm text-[var(--text-2)]">
              No rooms yet. Create one to start collaborating, or open the dashboard when you need the summary view.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {roomList.map((room) => (
                <Link
                  key={room.id}
                  href={`/room/${room.id}`}
                  className="block px-4 py-4 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text)]">{room.name}</p>
                      <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                        {room.members.length} members
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1.5">
                        {room.members.slice(0, 3).map((member) => (
                          <div
                            key={member.id}
                            className="w-6 h-6 rounded-full border border-[var(--surface)] text-[9px] text-white font-bold flex items-center justify-center"
                            style={{ background: member.color }}
                            title={member.name}
                          >
                            {member.name[0]?.toUpperCase()}
                          </div>
                        ))}
                      </div>
                      <span className="text-[11px] text-[var(--text-3)]">Open room</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
