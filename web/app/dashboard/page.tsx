'use client';

import { useState, useEffect } from 'react';
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

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) { router.replace('/login'); return; }
    loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, token]);

  async function loadRooms() {
    if (!token) return;
    try {
      const list = await rooms.list(token);
      setRoomList(list);
    } catch {
      setRoomList([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRoom(e: { preventDefault(): void }) {
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
    if (token) { try { await auth.logout(token); } catch {} }
    clearAuth();
    router.push('/login');
  }

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-40"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}
      >
        <span
          className="font-mono text-[10px] tracking-[0.4em] uppercase"
          style={{ color: 'var(--text-3)' }}
        >
          LIGMA
        </span>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-6 h-6 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
              style={{ background: user?.color ?? 'var(--accent)', borderRadius: '3px' }}
            >
              {initials}
            </div>
            <span className="text-sm hidden sm:block" style={{ color: 'var(--text-2)' }}>
              {user?.name}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="text-xs transition-colors"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-8 py-16">

        {/* Page heading row */}
        <div className="flex items-end justify-between mb-14">
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.25em] mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              Workspace
            </p>
            <h1 className="text-4xl font-bold" style={{ color: 'var(--text)' }}>
              {loading ? (
                <span className="inline-block w-6 h-8 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
              ) : (
                roomList.length
              )}{' '}
              {roomList.length === 1 ? 'Room' : 'Rooms'}
            </h1>
          </div>

          <button
            onClick={() => { setShowCreate(true); setCreateError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] transition-opacity hover:opacity-80"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: '3px' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            New Room
          </button>
        </div>

        {/* Room list */}
        {loading ? (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-6 py-5"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <div className="font-mono text-xl w-8" style={{ color: 'var(--border-2)' }}>
                  {String(i).padStart(2, '0')}
                </div>
                <div
                  className="h-4 rounded flex-1 animate-pulse"
                  style={{ background: 'var(--surface-2)', width: `${40 + i * 12}%` }}
                />
              </div>
            ))}
          </div>
        ) : roomList.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-mono text-6xl font-bold mb-4" style={{ color: 'var(--border-2)' }}>00</p>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              No rooms yet. Create one to get started.
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {roomList.map((room, i) => {
              const myRole = room.members?.find((m) => m.id === user?.id)?.role ?? 'viewer';
              return (
                <RoomRow key={room.id} room={room} index={i} myRole={myRole} />
              );
            })}
          </div>
        )}
      </main>

      {/* ── Create Room Modal ────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
          <div
            className="w-full max-w-sm p-8 animate-fade-in"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
            }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.25em] mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              New Room
            </p>
            <h2 className="text-xl font-bold mb-8" style={{ color: 'var(--text)' }}>
              Name your workspace
            </h2>

            <form onSubmit={handleCreateRoom} className="flex flex-col gap-6">
              <input
                className="input-line"
                placeholder="e.g. Design Sprint Q3"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                required
                autoFocus
              />
              {createError && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>{createError}</p>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2.5 text-sm font-semibold tracking-[0.05em] transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: '#fff', borderRadius: '3px' }}
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
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
          </div>
        </div>
      )}
    </div>
  );
}

function RoomRow({ room, index, myRole }: { room: Room; index: number; myRole: string }) {
  return (
    <Link href={`/room/${room.id}`}>
      <div
        className="group flex items-center gap-6 py-5 px-2 -mx-2 cursor-pointer transition-colors"
        style={{ borderBottom: '1px solid var(--border)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Index */}
        <span
          className="font-mono text-xl w-8 flex-shrink-0 text-right tabular-nums"
          style={{ color: 'var(--text-3)' }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* Name */}
        <span
          className="flex-1 text-base font-semibold truncate transition-colors"
          style={{ color: 'var(--text)' }}
        >
          {room.name}
        </span>

        {/* Meta */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Member dots */}
          <div className="flex -space-x-1.5 hidden sm:flex">
            {(room.members ?? []).slice(0, 4).map((m) => (
              <div
                key={m.id}
                title={m.name}
                className="w-5 h-5 rounded-full border text-[9px] flex items-center justify-center text-white font-bold"
                style={{ background: m.color, borderColor: 'var(--bg)' }}
              >
                {m.name[0]?.toUpperCase()}
              </div>
            ))}
          </div>

          <span className="text-xs hidden sm:block" style={{ color: 'var(--text-3)' }}>
            {room.members?.length ?? 0} {(room.members?.length ?? 0) === 1 ? 'member' : 'members'}
          </span>

          {/* Role badge */}
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5"
            style={{
              color: myRole === 'lead' ? 'var(--accent)' : 'var(--text-3)',
              border: `1px solid ${myRole === 'lead' ? 'rgba(69,117,243,0.4)' : 'var(--border-2)'}`,
              borderRadius: '2px',
            }}
          >
            {myRole}
          </span>
        </div>

        {/* Arrow */}
        <svg
          className="w-4 h-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5"
          style={{ color: 'var(--text-3)' }}
          fill="none"
          viewBox="0 0 16 16"
        >
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Link>
  );
}
