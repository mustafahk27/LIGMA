'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { invites } from '@/lib/api';
import type { InviteInfo } from '@/lib/api';

export default function InvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const { token: authToken, hydrate, hydrated, user } = useAuthStore();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!params.token) return;
    fetchInviteInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  async function fetchInviteInfo() {
    setLoading(true);
    try {
      const data = await invites.info(params.token);
      setInfo(data);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Invalid or expired invite');
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    if (!hydrated || !authToken) return;
    setAccepting(true);
    setError('');
    try {
      await invites.accept(params.token, authToken);
      setAccepted(true);
      setTimeout(() => {
        if (info?.room?.id) router.push(`/room/${info.room.id}`);
        else router.push('/dashboard');
      }, 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setAccepting(false);
    }
  }

  const isLoggedIn = hydrated && !!authToken;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 dot-grid">
      {/* Glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(139,92,246,0.07) 0%, transparent 70%)',
        }}
      />

      {/* Logo */}
      <Link
        href="/"
        className="mb-8 text-xl font-bold tracking-widest uppercase font-mono text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
        style={{ letterSpacing: '0.2em' }}
      >
        LIGMA
      </Link>

      {/* Card */}
      <div className="card w-full max-w-sm p-8 animate-fade-in shadow-2xl relative">
        {loading ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-6 h-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
            <p className="text-sm text-[var(--text-2)]">Loading invite…</p>
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--danger)]/10 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="9" stroke="var(--danger)" strokeWidth="1.5" />
                <path d="M11 7v5M11 15h.01" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-[var(--text)]">Invalid Invite</h2>
            <p className="text-sm text-[var(--text-2)]">{fetchError}</p>
            <Link href="/dashboard" className="btn btn-ghost text-xs mt-2">
              Go to Dashboard
            </Link>
          </div>
        ) : accepted ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--success)]/10 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="9" stroke="var(--success)" strokeWidth="1.5" />
                <path d="M7 11l3 3 5-5" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-[var(--text)]">You&apos;re in!</h2>
            <p className="text-sm text-[var(--text-2)]">
              Joining <strong className="text-[var(--text)]">{info?.room?.name}</strong>…
            </p>
          </div>
        ) : info ? (
          <>
            {/* Invite details */}
            <div className="flex flex-col items-center text-center mb-6">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white mb-4"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--violet))' }}
              >
                {info.room.name[0]?.toUpperCase()}
              </div>
              <h2 className="text-lg font-semibold text-[var(--text)]">
                You&apos;re invited!
              </h2>
              <p className="text-sm text-[var(--text-2)] mt-1">
                <strong className="text-[var(--text)]">{info.inviter.name}</strong> invited you to join
              </p>
              <p className="text-base font-semibold text-[var(--text)] mt-1">
                {info.room.name}
              </p>

              {/* Role badge */}
              <span
                className="mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
                style={{
                  background: 'rgba(69,117,243,0.12)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(69,117,243,0.25)',
                }}
              >
                as {info.role}
              </span>
            </div>

            {/* Action */}
            {!isLoggedIn ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-[var(--text-2)] text-center mb-2">
                  Sign in or create an account to accept this invite.
                </p>
                <Link
                  href={`/login?next=/invite/${params.token}`}
                  className="btn btn-primary w-full text-center"
                >
                  Sign in to accept
                </Link>
                <Link
                  href={`/register?next=/invite/${params.token}`}
                  className="btn btn-ghost w-full text-center"
                >
                  Create account
                </Link>
              </div>
            ) : (
              <>
                <p className="text-xs text-[var(--text-2)] text-center mb-3">
                  Accepting as <strong className="text-[var(--text)]">{user?.name}</strong>
                </p>

                {error && (
                  <p className="text-sm text-[var(--danger)] mb-3 text-center">{error}</p>
                )}

                <button
                  className="btn btn-primary w-full"
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Accepting…
                    </>
                  ) : (
                    'Accept Invite'
                  )}
                </button>

                <Link href="/dashboard" className="btn btn-ghost w-full mt-2 text-center">
                  Decline
                </Link>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
