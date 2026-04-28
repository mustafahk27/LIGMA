'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { rooms, auth } from '@/lib/api';
import type { Room } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const { user, token, hydrate, hydrated, clearAuth } = useAuthStore();

  const [roomList, setRoomList] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
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
    loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, token]);

  async function loadRooms() {
    if (!token) return;
    setLoading(true);
    try {
      const list = await rooms.list(token);
      setRoomList(list);
    } catch {
      // silently ignore — likely no rooms yet
      setRoomList([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!token || !newRoomName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const room = await rooms.create(newRoomName.trim(), token);
      setRoomList((prev) => [room, ...prev]);
      setNewRoomName('');
      setShowCreate(false);
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
        // ignore
      }
    }
    clearAuth();
    router.push('/login');
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Topbar ──────────────────────────────────────────────────── */}
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
          {/* Avatar */}
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

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10">
        {/* Page heading */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Your Rooms</h1>
            <p className="text-sm text-[var(--text-2)] mt-0.5">
              Select a room to open its canvas
            </p>
          </div>

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

        {/* Create room modal */}
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
                    {creating ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Creating…
                      </>
                    ) : (
                      'Create'
                    )}
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

        {/* Room list */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="card h-28 animate-pulse"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        ) : roomList.length === 0 ? (
          <EmptyState onCreateClick={() => setShowCreate(true)} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {roomList.map((room, i) => (
              <RoomCard key={room.id} room={room} delay={i * 0.05} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function RoomCard({ room, delay }: { room: Room; delay: number }) {
  const memberCount = room.members?.length ?? 0;

  return (
    <Link href={`/room/${room.id}`}>
      <div
        className="card p-5 cursor-pointer transition-all hover:border-[var(--border-2)] hover:bg-[var(--surface-2)] group animate-fade-in"
        style={{ animationDelay: `${delay}s` }}
      >
        <div className="flex items-start justify-between mb-3">
          {/* Room icon */}
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white"
            style={{ background: `linear-gradient(135deg, var(--accent), var(--violet))` }}
          >
            {room.name[0]?.toUpperCase() ?? '#'}
          </div>
          {/* Arrow on hover */}
          <svg
            className="w-4 h-4 text-[var(--text-3)] group-hover:text-[var(--accent)] transition-colors opacity-0 group-hover:opacity-100"
            fill="none"
            viewBox="0 0 16 16"
          >
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h3 className="font-semibold text-[var(--text)] text-sm group-hover:text-white transition-colors">
          {room.name}
        </h3>

        <div className="flex items-center justify-between mt-3">
          {/* Member avatars */}
          <div className="flex -space-x-1.5">
            {(room.members ?? []).slice(0, 5).map((m) => (
              <div
                key={m.id}
                className="w-5 h-5 rounded-full border border-[var(--surface)] flex items-center justify-center text-[9px] font-bold text-white"
                style={{ background: m.color }}
                title={m.name}
              >
                {m.name[0]?.toUpperCase()}
              </div>
            ))}
            {memberCount > 5 && (
              <div className="w-5 h-5 rounded-full border border-[var(--surface)] bg-[var(--surface-3)] flex items-center justify-center text-[9px] text-[var(--text-2)]">
                +{memberCount - 5}
              </div>
            )}
          </div>

          <span className="text-[11px] text-[var(--text-3)]">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
      {/* Icon */}
      <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center mb-4">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="3" y="3" width="22" height="22" rx="4" stroke="var(--text-3)" strokeWidth="1.5" />
          <path d="M14 9v10M9 14h10" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-[var(--text)] mb-1">No rooms yet</h3>
      <p className="text-sm text-[var(--text-2)] max-w-xs mb-6">
        Create your first room to start collaborating on a canvas with your team.
      </p>
      <button className="btn btn-primary" onClick={onCreateClick}>
        Create a room
      </button>
    </div>
  );
}
