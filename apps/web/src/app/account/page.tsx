'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RequireAuth } from '@/components/RequireAuth';
import { Tabs } from '@/components/Tabs';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmt, fmtCompact, fmtDateTime, fmtPrice } from '@/lib/format';

type Tab = 'overview' | 'security' | 'kyc' | 'api' | 'fees' | 'alerts' | 'activity';
const TABS: Tab[] = ['overview', 'security', 'kyc', 'api', 'fees', 'alerts', 'activity'];

function useSubmit() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'success');
      return true;
    } catch (e) {
      toast(errMsg(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Overview() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user!.name ?? '');
  const { busy, run } = useSubmit();
  const rows = [
    ['Email', <>{user!.email} {user!.emailVerified ? <StatusBadge status="APPROVED" /> : <span className="text-xs text-down">unverified</span>}</>],
    ['Two-factor authentication', user!.totpEnabled ? 'Enabled' : 'Disabled'],
    ['Identity verification', <StatusBadge key="k" status={user!.kycStatus === 'NONE' ? 'NOT_STARTED' : user!.kycStatus} />],
    ['Member since', fmtDateTime(user!.createdAt)],
  ];
  return (
    <div className="space-y-6">
      <div className="card divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k as string} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm">
            <span className="text-muted">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <div className="card max-w-md space-y-3 p-5">
        <h3 className="font-semibold">Profile</h3>
        <Field label="Display name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button className="btn-brand" disabled={busy || !name.trim()} onClick={() => run(() => api('/api/account/profile', { method: 'PATCH', body: { name } }).then(refresh), 'Profile updated')}>Save</button>
        {!user!.emailVerified && (
          <button className="btn-ghost ml-2" onClick={() => run(() => api('/api/auth/resend-verification', { method: 'POST' }), 'Verification email sent')}>Resend verification email</button>
        )}
      </div>
    </div>
  );
}

function Security() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const { busy, run } = useSubmit();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-5">
        <h3 className="font-semibold">Authenticator app (2FA)</h3>
        <p className="text-sm text-muted">Protect logins, withdrawals and API keys with a 6-digit code from Google Authenticator, Authy or 1Password.</p>
        {user!.totpEnabled ? (
          <>
            <p className="text-sm text-up">✓ 2FA is enabled.</p>
            <Field label="Enter a current code to disable"><input className="input num" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <button className="btn-down" disabled={busy || code.length !== 6} onClick={async () => { if (await run(() => api('/api/account/2fa/disable', { method: 'POST', body: { code } }), '2FA disabled')) { setCode(''); refresh(); } }}>Disable 2FA</button>
          </>
        ) : setup ? (
          <>
            <img src={setup.qr} alt="2FA QR code" className="h-44 w-44 rounded bg-white p-2" />
            <p className="text-xs text-muted">Can't scan? Enter this key manually: <code className="num break-all text-fg">{setup.secret}</code></p>
            <Field label="6-digit code"><input className="input num" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <button className="btn-brand" disabled={busy || code.length !== 6} onClick={async () => { if (await run(() => api('/api/account/2fa/enable', { method: 'POST', body: { code } }), '2FA enabled')) { setSetup(null); setCode(''); refresh(); } }}>Enable 2FA</button>
          </>
        ) : (
          <button className="btn-brand" disabled={busy} onClick={() => run(async () => setSetup(await api('/api/account/2fa/setup', { method: 'POST' })))}>Set up 2FA</button>
        )}
      </div>
      <div className="card space-y-3 p-5">
        <h3 className="font-semibold">{user!.hasPassword ? 'Change password' : 'Set a password'}</h3>
        {user!.hasPassword && <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>}
        <Field label="New password" hint="8+ characters with upper, lower case and a number. Other devices will be signed out.">
          <input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <button className="btn-brand" disabled={busy || !pw.next} onClick={async () => { if (await run(() => api('/api/account/password', { method: 'POST', body: pw }), 'Password updated')) { setPw({ current: '', next: '' }); refresh(); } }}>Update password</button>
      </div>
      <div className="card space-y-3 p-5">
        <h3 className="font-semibold">Sessions</h3>
        <p className="text-sm text-muted">Signed in somewhere you don't recognise? Sign out everywhere, including this device.</p>
        <button className="btn-ghost" onClick={() => run(async () => { await api('/api/auth/logout-all', { method: 'POST' }); await refresh(); router.push('/login'); })}>Sign out of all devices</button>
      </div>
    </div>
  );
}

const COUNTRY_NAMES: Record<string, string> = { AE: 'United Arab Emirates', IN: 'India', US: 'United States' };

function Kyc() {
  const meta = useApi<{ allowedCountries: string[] }>('/api/meta');
  const { refresh } = useAuth();
  const kyc = useApi<{ status: string; submission: any }>('/api/account/kyc');
  const { busy, run } = useSubmit();
  const [f, setF] = useState({ fullName: '', dateOfBirth: '', country: '', idType: 'PASSPORT', idNumber: '' });
  const status = kyc.data?.status;
  if (!kyc.data) return <p className="text-muted">Loading…</p>;
  if (status === 'PENDING' || status === 'APPROVED')
    return (
      <div className="card max-w-lg space-y-2 p-5 text-sm">
        <div className="flex items-center gap-2"><span className="font-semibold">Status</span> <StatusBadge status={status} /></div>
        <p className="text-muted">{status === 'PENDING' ? 'Your documents are under review. This usually takes less than 24 hours.' : 'Your identity is verified. Withdrawals are enabled.'}</p>
        {kyc.data.submission && <p className="text-muted">Submitted as {kyc.data.submission.fullName} · {kyc.data.submission.idType.replace('_', ' ').toLowerCase()} {kyc.data.submission.idNumber}</p>}
      </div>
    );
  return (
    <div className="card max-w-lg space-y-3 p-5">
      <h3 className="font-semibold">Verify your identity</h3>
      {status === 'REJECTED' && <p className="rounded bg-down/10 px-3 py-2 text-sm text-down">Your previous submission was rejected{kyc.data.submission?.reviewNote ? `: ${kyc.data.submission.reviewNote}` : ''}. Please resubmit.</p>}
      <Field label="Full legal name"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth"><input className="input" type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} /></Field>
        <Field label="Country of residence">
          <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
            <option value="">Select…</option>
            {(meta.data?.allowedCountries ?? []).map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID type">
          <select className="input" value={f.idType} onChange={(e) => setF({ ...f, idType: e.target.value })}>
            <option value="PASSPORT">Passport</option>
            <option value="NATIONAL_ID">National ID</option>
            <option value="EMIRATES_ID">Emirates ID</option>
            <option value="DRIVING_LICENSE">Driving licence</option>
            <option value="PAN">PAN card</option>
          </select>
        </Field>
        <Field label="ID number"><input className="input" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-muted">Phase 2 will add document upload and liveness checks via a KYC provider.</p>
      <button className="btn-brand" disabled={busy} onClick={async () => { if (await run(() => api('/api/account/kyc', { method: 'POST', body: f }), 'Submitted for review')) { kyc.reload(); refresh(); } }}>Submit</button>
    </div>
  );
}

function ApiKeys() {
  const { user } = useAuth();
  const keys = useApi<{ id: string; label: string; key: string; canTrade: boolean; lastUsedAt: string | null; createdAt: string }[]>('/api/account/api-keys');
  const { busy, run } = useSubmit();
  const [label, setLabel] = useState('');
  const [canTrade, setCanTrade] = useState(false);
  const [code, setCode] = useState('');
  const [created, setCreated] = useState<{ key: string; secret: string } | null>(null);
  return (
    <div className="space-y-4">
      {created && (
        <div className="card space-y-2 border-brand/60 p-5 text-sm">
          <p className="font-semibold">Save your secret now — it won't be shown again.</p>
          <p>API key: <code className="num break-all">{created.key}</code></p>
          <p>Secret: <code className="num break-all">{created.secret}</code></p>
          <button className="btn-ghost" onClick={() => setCreated(null)}>I've saved it</button>
        </div>
      )}
      <div className="card flex flex-wrap items-end gap-3 p-5">
        <Field label="Label"><input className="input w-56" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trading bot" /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={canTrade} onChange={(e) => setCanTrade(e.target.checked)} /> Enable trading</label>
        {user!.totpEnabled && <Field label="2FA code"><input className="input num w-28" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>}
        <button className="btn-brand" disabled={busy || !label.trim()} onClick={() => run(async () => { setCreated(await api('/api/account/api-keys', { method: 'POST', body: { label, canTrade, code: code || undefined } })); setLabel(''); setCode(''); keys.reload(); })}>Create API key</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead><tr className="border-b border-line">{['Label', 'API key', 'Permissions', 'Last used', 'Created', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {keys.data?.map((k) => (
              <tr key={k.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-3 font-medium">{k.label}</td>
                <td className="num px-4 text-xs text-muted">{k.key.slice(0, 12)}…</td>
                <td className="px-4 text-xs">{k.canTrade ? 'Read + Trade' : 'Read only'}</td>
                <td className="px-4 text-xs text-muted">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : 'Never'}</td>
                <td className="px-4 text-xs text-muted">{fmtDateTime(k.createdAt)}</td>
                <td className="px-4 text-right"><button className="text-xs text-down hover:underline" onClick={() => run(() => api(`/api/account/api-keys/${k.id}`, { method: 'DELETE' }).then(keys.reload), 'API key deleted')}>Delete</button></td>
              </tr>
            ))}
            {!keys.data?.length && <tr><td colSpan={6} className="p-8 text-center text-muted">No API keys</td></tr>}
          </tbody>
        </table>
      </div>
      <details className="card p-5 text-sm">
        <summary className="cursor-pointer font-semibold">How to sign API requests</summary>
        <pre className="num mt-3 overflow-x-auto rounded bg-panel2 p-3 text-xs">{`Headers:
  X-API-KEY:        <api key>
  X-API-TIMESTAMP:  <unix ms, within 30s of server time>
  X-API-SIGNATURE:  hex(HMAC_SHA256(secret, timestamp + METHOD + path_with_query + json_body))

Example (Node):
  const ts = Date.now().toString();
  const body = JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.001' });
  const sig = crypto.createHmac('sha256', SECRET).update(ts + 'POST' + '/api/orders' + body).digest('hex');
  fetch(BASE + '/api/orders', { method: 'POST', body, headers: {
    'content-type': 'application/json', 'x-api-key': KEY, 'x-api-timestamp': ts, 'x-api-signature': sig } });`}</pre>
      </details>
    </div>
  );
}

function Fees() {
  const { refresh } = useAuth();
  const fees = useApi<any>('/api/fees');
  const { busy, run } = useSubmit();
  if (!fees.data) return <p className="text-muted">Loading…</p>;
  const { me, tiers, feeToken, feeTokenDiscount, baseMakerFee, baseTakerFee } = fees.data;
  const pct = (base: string, mult: number) => `${parseFloat((+base * mult * 100).toFixed(4))}%`;
  const next = tiers.find((t: any) => t.minVolume > (me?.volume30d ?? 0));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-5"><div className="text-xs text-muted">Your VIP level</div><div className="mt-1 text-3xl font-bold text-brand">VIP {me?.level ?? 0}</div></div>
        <div className="card p-5">
          <div className="text-xs text-muted">30-day trading volume</div>
          <div className="num mt-1 text-2xl font-bold">${fmt(me?.volume30d ?? 0, 2)}</div>
          {next && <div className="mt-2 h-1.5 overflow-hidden rounded bg-panel2"><div className="h-full bg-brand" style={{ width: `${Math.min(100, ((me?.volume30d ?? 0) / next.minVolume) * 100)}%` }} /></div>}
          {next && <div className="mt-1 text-xs text-muted">${fmtCompact(next.minVolume - (me?.volume30d ?? 0))} more to VIP {next.level}</div>}
        </div>
        <div className="card p-5">
          <div className="text-xs text-muted">Pay fees with {feeToken}</div>
          <div className="mt-1 text-sm">Get <b className="text-up">{feeTokenDiscount * 100}% off</b> trading fees when you hold {feeToken}.</div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={busy} checked={!!me?.payWithToken} onChange={(e) => run(() => api('/api/fees/settings', { method: 'PATCH', body: { payFeesWithToken: e.target.checked } }).then(() => { fees.reload(); refresh(); }), 'Fee setting updated')} />
            Use {feeToken} to pay fees
          </label>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line">{['Level', '30d volume (USD)', 'Maker', 'Taker', `Maker w/ ${feeToken}`, `Taker w/ ${feeToken}`].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {tiers.map((t: any) => (
              <tr key={t.level} className={`border-b border-line/50 last:border-0 ${t.level === me?.level ? 'bg-brand/10' : ''}`}>
                <td className="px-4 py-2 font-semibold">VIP {t.level}</td>
                <td className="num px-4">{t.minVolume ? `≥ $${fmtCompact(t.minVolume)}` : '< $1M'}</td>
                <td className="num px-4">{pct(baseMakerFee, t.makerMult)}</td>
                <td className="num px-4">{pct(baseTakerFee, t.takerMult)}</td>
                <td className="num px-4 text-up">{pct(baseMakerFee, t.makerMult * (1 - feeTokenDiscount))}</td>
                <td className="num px-4 text-up">{pct(baseTakerFee, t.takerMult * (1 - feeTokenDiscount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Alerts() {
  const alerts = useApi<any[]>('/api/alerts');
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="border-b border-line">{['Pair', 'Condition', 'Note', 'Status', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {alerts.data?.map((a) => (
            <tr key={a.id} className="border-b border-line/50 last:border-0">
              <td className="px-4 py-2"><Link href={`/trade/${a.symbol}`} className="font-medium hover:text-brand">{a.symbol.replace('USDT', '/USDT')}</Link></td>
              <td className={`num px-4 ${a.direction === 'ABOVE' ? 'text-up' : 'text-down'}`}>{a.direction === 'ABOVE' ? '≥' : '≤'} {fmtPrice(a.price)}</td>
              <td className="px-4 text-xs text-muted">{a.note ?? '—'}</td>
              <td className="px-4 text-xs">{a.active ? 'Active' : `Triggered ${a.triggeredAt ? fmtDateTime(a.triggeredAt) : ''}`}</td>
              <td className="px-4 text-right"><button className="text-xs text-down" onClick={() => api(`/api/alerts/${a.id}`, { method: 'DELETE' }).then(alerts.reload)}>Delete</button></td>
            </tr>
          ))}
          {!alerts.data?.length && <tr><td colSpan={5} className="p-8 text-center text-muted">No alerts. Create one from the 🔔 button on any trading page.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Activity() {
  const logs = useApi<{ id: string; action: string; ip: string | null; userAgent: string | null; createdAt: string }[]>('/api/account/activity');
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead><tr className="border-b border-line">{['Time', 'Activity', 'IP address', 'Device'].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {logs.data?.map((l) => (
            <tr key={l.id} className="border-b border-line/50 last:border-0">
              <td className="num px-4 py-2 text-xs text-muted">{fmtDateTime(l.createdAt)}</td>
              <td className="px-4 text-xs">{l.action.replace(/[._]/g, ' ')}</td>
              <td className="num px-4 text-xs text-muted">{l.ip ?? '—'}</td>
              <td className="max-w-[280px] truncate px-4 text-xs text-muted" title={l.userAgent ?? ''}>{l.userAgent ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountTabs() {
  const params = useSearchParams();
  const initial = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : 'overview');
  return (
    <>
      <div className="mx-auto max-w-[1100px] px-4 py-8">
        <h1 className="mb-4 text-2xl font-bold">Account</h1>
        <Tabs<Tab>
          className="mb-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'security', label: 'Security' },
            { id: 'kyc', label: 'Identity verification' },
            { id: 'api', label: 'API keys' },
            { id: 'fees', label: 'Fees & VIP' },
            { id: 'alerts', label: 'Price alerts' },
            { id: 'activity', label: 'Activity log' },
          ]}
        />
        {tab === 'overview' && <Overview />}
        {tab === 'security' && <Security />}
        {tab === 'kyc' && <Kyc />}
        {tab === 'api' && <ApiKeys />}
        {tab === 'fees' && <Fees />}
        {tab === 'alerts' && <Alerts />}
        {tab === 'activity' && <Activity />}
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <RequireAuth>
      <Suspense>
        <AccountTabs />
      </Suspense>
    </RequireAuth>
  );
}
