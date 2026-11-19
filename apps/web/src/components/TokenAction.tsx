'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthCard } from './AuthCard';
import { api, errMsg } from '@/lib/api';

/** Posts ?token=... to an endpoint once and shows the result. */
export function TokenAction({ endpoint, title, success, after }: { endpoint: string; title: string; success: string; after?: () => void }) {
  const token = useSearchParams().get('token') || '';
  const [state, setState] = useState<{ ok?: boolean; msg?: string }>({});
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    api(endpoint, { method: 'POST', body: { token } })
      .then(() => {
        setState({ ok: true, msg: success });
        after?.();
      })
      .catch((e) => setState({ ok: false, msg: errMsg(e) }));
  }, [endpoint, token, success, after]);
  return (
    <AuthCard title={title}>
      {state.ok === undefined ? (
        <p className="text-muted">Working…</p>
      ) : (
        <p className={state.ok ? 'text-up' : 'text-down'}>{state.msg}</p>
      )}
      <Link href="/markets" className="btn-ghost mt-6 w-full">Continue</Link>
    </AuthCard>
  );
}
