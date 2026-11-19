'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AuthCard, FormError } from '@/components/AuthCard';
import { Field } from '@/components/Field';
import { api, errMsg } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <p className="text-sm">Password updated. You've been signed out of all devices. <Link href="/login" className="text-brand">Log in</Link></p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <Field label="New password" hint="8+ characters with upper, lower case and a number.">
            <input className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn-brand w-full">Update password</button>
        </form>
      )}
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Reset /></Suspense>;
}
