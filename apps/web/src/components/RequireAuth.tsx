'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export function RequireAuth({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path || '/')}`);
  }, [loading, user, router, path]);
  if (loading || !user) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (admin && user.role !== 'ADMIN') return <div className="p-10 text-center text-muted">You don't have access to this page.</div>;
  return <>{children}</>;
}
