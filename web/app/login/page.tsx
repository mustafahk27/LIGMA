'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { auth } from '@/lib/api';
import { CanvasPreview } from '@/components/CanvasPreview';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, hydrate, token } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (token) router.replace('/');
  }, [token, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.login({ email, password });
      setAuth(res.user, res.token);
      router.push('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-screen">
      {/* ── Left: Form ──────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center w-full max-w-[480px] min-h-screen px-10 py-12 bg-[var(--bg)] border-r border-[var(--border)]">
        {/* Logo */}
        <div className="mb-10 animate-fade-in">
          <span
            className="text-2xl font-bold tracking-widest uppercase font-mono text-[var(--text)]"
            style={{ letterSpacing: '0.2em' }}
          >
            LIGMA
          </span>
          <p className="mt-1 text-xs text-[var(--text-3)] font-mono tracking-wider uppercase">
            Collaborative Canvas
          </p>
        </div>

        <div className="animate-fade-in" style={{ animationDelay: '0.05s' }}>
          <h1 className="text-2xl font-semibold text-[var(--text)] mb-1">
            Welcome back
          </h1>
          <p className="text-sm text-[var(--text-2)] mb-8">
            Sign in to your workspace
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5 uppercase tracking-wider">
                Email
              </label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 px-3 py-2 rounded-lg border border-[var(--danger)]/20">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full mt-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="mt-6 text-sm text-[var(--text-2)] text-center">
            Don&apos;t have an account?{' '}
            <Link
              href="/register"
              className="text-[var(--accent)] hover:underline font-medium"
            >
              Register
            </Link>
          </p>
        </div>

        <p className="mt-auto pt-10 text-xs text-[var(--text-3)] text-center">
          DevDay &apos;26 · Invite-only access
        </p>
      </div>

      {/* ── Right: Canvas preview ────────────────────────────────────── */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden dot-grid">
        <CanvasPreview />
      </div>
    </div>
  );
}
