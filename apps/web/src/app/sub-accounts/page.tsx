'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';
import { Modal } from '@/components/Modal';
import { Field } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmt, fmtDateTime, fmtQty } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Data {
  master: { id: string; email: string; totalUsd: number };
  subs: { id: string; label: string; email: string; frozen: boolean; createdAt: string; totalUsd: number; balances: { asset: string; available: string; locked: string }[] }[];
}

function SubAccounts() {
  const toast = useToast();
  const router = useRouter();
  const { refresh, user } = useAuth();
  const data = useApi<Data>('/api/subaccounts', { refreshOnUserEvent: true });
  const assets = useApi<Asset[]>('/api/wallet/assets');
  const [label, setLabel] = useState('');
  const [xfer, setXfer] = useState<{ fromId: string; toId: string; asset: string; amount: string } | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
      data.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const switchTo = async (id: string) => {
    try {
      await api(`/api/subaccounts/${id}/switch`, { method: 'POST' });
      await refresh();
      router.push('/wallet');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  if (user?.isSubAccount) return <div className="p-10 text-center text-muted">Switch back to your main account to manage sub-accounts.</div>;
  if (!data.data) return <div className="p-10 text-center text-muted">Loading…</div>;
  const accounts = [{ id: data.data.master.id, label: 'Main account' }, ...data.data.subs.map((s) => ({ id: s.id, label: s.label }))];
  const total = data.data.master.totalUsd + data.data.subs.reduce((s, x) => s + x.totalUsd, 0);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sub-accounts</h1>
          <p className="mt-1 text-sm text-muted">Separate strategies or bots into isolated accounts. Move funds instantly and for free.</p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-muted">Total across all accounts</div>
          <div className="num text-xl font-bold">${fmt(total, 2)}</div>
        </div>
      </div>
      <div className="card flex flex-wrap gap-2 p-4">
        <input className="input max-w-xs" placeholder="New sub-account name (e.g. Grid bot)" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn-brand" disabled={!label.trim()} onClick={() => act(async () => { await api('/api/subaccounts', { method: 'POST', body: { label } }); setLabel(''); }, 'Sub-account created')}>Create</button>
        <button className="btn-ghost ml-auto" onClick={() => setXfer({ fromId: data.data!.master.id, toId: data.data!.subs[0]?.id ?? '', asset: 'USDT', amount: '' })} disabled={!data.data.subs.length}>Transfer funds</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-line">{['Account', 'Holdings', 'Value (USD)', 'Created', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
          <tbody>
            <tr className="border-b border-line/50">
              <td className="px-4 py-3 font-medium">Main account <span className="text-xs text-muted">{data.data.master.email}</span></td>
              <td className="px-4 text-xs text-muted">—</td>
              <td className="num px-4">${fmt(data.data.master.totalUsd, 2)}</td>
              <td />
              <td />
            </tr>
            {data.data.subs.map((s) => (
              <tr key={s.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.label} {s.frozen && <span className="text-xs text-down">frozen</span>}</div>
                  <div className="text-[11px] text-muted">{s.email}</div>
                </td>
                <td className="px-4 text-xs">{s.balances.map((b) => `${fmtQty(+b.available + +b.locked, 6)} ${b.asset}`).join(', ') || <span className="text-muted">Empty</span>}</td>
                <td className="num px-4">${fmt(s.totalUsd, 2)}</td>
                <td className="px-4 text-xs text-muted">{fmtDateTime(s.createdAt)}</td>
                <td className="whitespace-nowrap px-4 text-right text-xs">
                  <button className="mr-3 text-brand" onClick={() => setXfer({ fromId: data.data!.master.id, toId: s.id, asset: 'USDT', amount: '' })}>Fund</button>
                  <button className="mr-3 text-brand" disabled={s.frozen} onClick={() => switchTo(s.id)}>Switch to</button>
                  <button className={s.frozen ? 'text-up' : 'text-down'} onClick={() => act(() => api(`/api/subaccounts/${s.id}`, { method: 'PATCH', body: { frozen: !s.frozen } }), s.frozen ? 'Unfrozen' : 'Frozen')}>{s.frozen ? 'Unfreeze' : 'Freeze'}</button>
                </td>
              </tr>
            ))}
            {!data.data.subs.length && <tr><td colSpan={5} className="p-8 text-center text-muted">No sub-accounts yet</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={!!xfer} onClose={() => setXfer(null)} title="Transfer between accounts">
        {xfer && (
          <div className="space-y-3">
            <Field label="From"><select className="input" value={xfer.fromId} onChange={(e) => setXfer({ ...xfer, fromId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
            <Field label="To"><select className="input" value={xfer.toId} onChange={(e) => setXfer({ ...xfer, toId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
            <Field label="Coin"><select className="input" value={xfer.asset} onChange={(e) => setXfer({ ...xfer, asset: e.target.value })}>{assets.data?.map((a) => <option key={a.symbol}>{a.symbol}</option>)}</select></Field>
            <Field label="Amount"><input className="input num" inputMode="decimal" value={xfer.amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setXfer({ ...xfer, amount: e.target.value })} /></Field>
            <button className="btn-brand w-full" disabled={!+xfer.amount || xfer.fromId === xfer.toId} onClick={() => act(async () => { await api('/api/subaccounts/transfer', { method: 'POST', body: xfer }); setXfer(null); }, 'Transfer complete')}>Transfer</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><SubAccounts /></RequireAuth>;
}
