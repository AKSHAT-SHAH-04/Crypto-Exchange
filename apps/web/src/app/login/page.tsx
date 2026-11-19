'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard, FormError } from '@/components/AuthCard';
import { Field } from '@/components/Field';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

function Login() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh, googleEnabled, user } = useAuth();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(params.get('ticket'));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);
  const next = params.get('next') || '/markets';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/markets';

  useEffect(() => {
    if (user) router.replace(safeNext);
  }, [user, router, safeNext]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (ticket) {
        await api('/api/auth/login/2fa', { method: 'POST', body: { ticket, code } });
      } else {
        const r = await api<{ twoFactorRequired?: boolean; ticket?: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
        if (r.twoFactorRequired) {
          setTicket(r.ticket!);
          return;
        }
      }
      await refresh();
      router.push(safeNext);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (ticket)
    return (
      <AuthCard title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <input className="input num text-center text-xl tracking-[0.5em]" inputMode="numeric" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn-brand w-full" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify'}</button>
          <button type="button" className="w-full text-sm text-muted hover:text-fg" onClick={() => { setTicket(null); setCode(''); }}>Back to login</button>
        </form>
      </AuthCard>
    );

  return (
    <AuthCard title={t('auth.login')} subtitle={t('auth.welcome')}>
      <form onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Field label={t('auth.email')}>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')}>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="text-right text-sm">
          <Link href="/forgot-password" className="text-brand hover:underline">{t('auth.forgot')}</Link>
        </div>
        <button className="btn-brand w-full" disabled={busy}>{busy ? '…' : t('auth.login')}</button>
        {googleEnabled && (
          <a href="/api/auth/google" className="btn-ghost w-full">
            <span className="font-bold">G</span> {t('auth.google')}
          </a>
        )}
        <p className="text-center text-sm text-muted">
          {t('auth.new')} <Link href="/register" className="text-brand hover:underline">{t('auth.createAccount')}</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
