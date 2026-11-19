'use client';
import { Suspense } from 'react';
import { TokenAction } from '@/components/TokenAction';
import { useAuth } from '@/lib/auth';

function Verify() {
  const { refresh } = useAuth();
  return <TokenAction endpoint="/api/auth/verify-email" title="Email verification" success="Your email has been verified." after={refresh} />;
}
export default function Page() {
  return <Suspense><Verify /></Suspense>;
}
