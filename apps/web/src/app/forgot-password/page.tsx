'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthCard, FormError } from '@/components/AuthCard';
import { Field } from '@/components/Field';
import { api, errMsg } from '@/lib/api';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Reset password" subtitle="We'll email you a link to set a new password.">
      {sent ? (
        <p className="text-sm">If an account exists for <b>{email}</b>, a reset link is on its way. <Link href="/login" className="text-brand">Back to login</Link></p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <button className="btn-brand w-full" disabled={busy}>Send reset link</button>
        </form>
      )}
    </AuthCard>
  );
}
