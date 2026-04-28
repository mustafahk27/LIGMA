'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

export default function Root() {
  const router = useRouter();
  const { hydrate, hydrated, token } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (token) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
    </div>
  );
}
