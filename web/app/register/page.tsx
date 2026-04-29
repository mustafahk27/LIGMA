'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { auth } from '@/lib/api';
import { CanvasPreview } from '@/components/CanvasPreview';

const COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#38bdf8', '#818cf8', '#e879f9', '#f472b6',
];

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth, hydrate, token } = useAuthStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => { if (token) router.replace('/dashboard'); }, [token, router]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.register({ name, email, password, color });
      setAuth(res.user, res.token);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* ── Left: form panel ────────────────────────────────────────── */}
      <div
        className="flex flex-col w-full max-w-[440px] min-h-screen px-12 py-10"
        style={{ borderRight: '1px solid var(--border)' }}
      >
        {/* Wordmark */}
        <span
          className="font-mono text-[10px] tracking-[0.45em] uppercase mb-auto pb-20"
          style={{ color: 'var(--text-3)' }}
        >
          LIGMA
        </span>

        {/* Hero text */}
        <div className="mb-12">
          <h1
            className="text-[52px] font-bold leading-[1.0] tracking-tight"
            style={{ color: 'var(--text)' }}
          >
            Join your<br />team.
          </h1>
          <p className="mt-4 text-sm" style={{ color: 'var(--text-3)' }}>
            Create an account to start collaborating.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-7">
          <Field label="Display Name">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="input-line"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="input-line"
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="input-line"
            />
          </Field>

          {/* Color picker */}
          <Field label="Cursor Color">
            <div className="flex gap-3 pt-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-6 h-6 transition-transform hover:scale-110 focus:outline-none flex-shrink-0"
                  style={{
                    background: c,
                    borderRadius: '50%',
                    boxShadow: color === c ? `0 0 0 2px var(--bg), 0 0 0 3.5px ${c}` : 'none',
                    transform: color === c ? 'scale(1.25)' : undefined,
                  }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>

          {error && (
            <p
              className="text-xs px-4 py-3"
              style={{
                color: 'var(--danger)',
                borderLeft: '2px solid var(--danger)',
                background: 'rgba(242,87,87,0.06)',
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 text-sm font-semibold tracking-[0.1em] uppercase transition-opacity disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: '3px' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Creating account…
              </span>
            ) : (
              'Create account'
            )}
          </button>
        </form>

        <p className="mt-8 text-xs" style={{ color: 'var(--text-3)' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: 'var(--accent)' }} className="font-medium hover:underline">
            Sign in →
          </Link>
        </p>

        <p
          className="mt-auto pt-20 text-[10px] tracking-[0.15em] uppercase"
          style={{ color: 'var(--text-3)' }}
        >
          DevDay &apos;26 · Invite-only
        </p>
      </div>

      {/* ── Right: canvas preview ────────────────────────────────────── */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden dot-grid">
        <CanvasPreview />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <label
        className="text-[10px] font-semibold uppercase tracking-[0.25em]"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
