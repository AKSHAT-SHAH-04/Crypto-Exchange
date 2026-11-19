'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthCard, FormError } from '@/components/AuthCard';
import { Field } from '@/components/Field';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Register() {
  const router = useRouter();
  const { refresh, googleEnabled, tradingMode } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pw = form.password;
  const checks = [
    { ok: pw.length >= 8, t: '8+ characters' },
    { ok: /[A-Z]/.test(pw), t: 'Uppercase' },
    { ok: /[a-z]/.test(pw), t: 'Lowercase' },
    { ok: /\d/.test(pw), t: 'Number' },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/register', { method: 'POST', body: form });
      await refresh();
      router.push('/wallet?welcome=1');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your account" subtitle={tradingMode === 'paper' ? 'Get 10,000 demo USDT to start trading instantly.' : undefined}>
      <form onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <Field label="Name">
          <input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-2 text-xs">
          {checks.map((c) => (
            <span key={c.t} className={c.ok ? 'text-up' : 'text-muted'}>{c.ok ? '✓' : '○'} {c.t}</span>
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I agree to the Terms of Service and Privacy Policy.
        </label>
        <button className="btn-brand w-full" disabled={busy || !agree || !checks.every((c) => c.ok)}>{busy ? 'Creating account…' : 'Create account'}</button>
        {googleEnabled && (
          <a href="/api/auth/google" className="btn-ghost w-full"><span className="font-bold">G</span> Sign up with Google</a>
        )}
        <p className="text-center text-sm text-muted">
          Already have an account? <Link href="/login" className="text-brand hover:underline">Log in</Link>
        </p>
      </form>
    </AuthCard>
  );
}
