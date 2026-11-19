'use client';
import { useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { Tabs } from '@/components/Tabs';
import { Modal } from '@/components/Modal';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmt, fmtDateTime, fmtQty } from '@/lib/format';

type Tab = 'dashboard' | 'users' | 'kyc' | 'withdrawals' | 'markets' | 'audit';

function useAction() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    try {
      await fn();
      toast(ok, 'success');
      after?.();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
}

const Th = ({ cols }: { cols: string[] }) => (
  <thead><tr className="border-b border-line">{cols.map((c) => <th key={c} className="table-head px-4 py-2">{c}</th>)}</tr></thead>
);

function Dashboard() {
  const { data } = useApi<Record<string, number>>('/api/admin/stats');
  if (!data) return <p className="text-muted">Loading…</p>;
  const cards = [
    ['Users', data.users], ['New users (24h)', data.newUsers], ['KYC pending', data.kycPending],
    ['Withdrawals pending', data.withdrawalsPending], ['Trades (24h)', data.trades24h], ['Open orders', data.openOrders],
    ['Fees earned (24h)', `$${fmt(data.feesUsd24h, 2)}`],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([k, v]) => (
        <div key={k} className="card p-5">
          <div className="text-xs text-muted">{k}</div>
          <div className="num mt-2 text-2xl font-bold">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const users = useApi<any[]>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const act = useAction();
  const [detail, setDetail] = useState<any | null>(null);
  const [adj, setAdj] = useState({ asset: 'USDT', amount: '', note: '' });
  const open = async (id: string) => setDetail(await api(`/api/admin/users/${id}`));
  return (
    <div className="space-y-3">
      <input className="input max-w-sm" placeholder="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <Th cols={['Email', 'Name', 'Role', 'Email verified', '2FA', 'KYC', 'Joined', '']} />
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2"><button className="hover:text-brand" onClick={() => open(u.id)}>{u.email}</button></td>
                <td className="px-4 text-muted">{u.name ?? '—'}</td>
                <td className="px-4 text-xs">{u.role}</td>
                <td className="px-4 text-xs">{u.emailVerified ? 'Yes' : 'No'}</td>
                <td className="px-4 text-xs">{u.totpEnabled ? 'On' : 'Off'}</td>
                <td className="px-4"><StatusBadge status={u.kycStatus} /></td>
                <td className="px-4 text-xs text-muted">{fmtDateTime(u.createdAt)}</td>
                <td className="whitespace-nowrap px-4 text-right text-xs">
                  <button className={u.frozen ? 'text-up' : 'text-down'} onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { frozen: !u.frozen } }), u.frozen ? 'User unfrozen' : 'User frozen and orders canceled', users.reload)}>
                    {u.frozen ? 'Unfreeze' : 'Freeze'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.email ?? ''} wide>
        {detail && (
          <div className="space-y-4 text-sm">
            <table className="w-full">
              <Th cols={['Asset', 'Available', 'Locked']} />
              <tbody>
                {detail.balances.map((b: any) => (
                  <tr key={b.asset}><td className="px-4 py-1">{b.asset}</td><td className="num px-4">{fmtQty(b.available, 8)}</td><td className="num px-4">{fmtQty(b.locked, 8)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-2">
              <input className="input" placeholder="Asset" value={adj.asset} onChange={(e) => setAdj({ ...adj, asset: e.target.value.toUpperCase() })} />
              <input className="input" placeholder="Amount (+/-)" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
              <input className="input" placeholder="Reason" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
            </div>
            <button className="btn-brand" disabled={!adj.amount || !adj.note} onClick={() => act(() => api(`/api/admin/users/${detail.id}/adjust`, { method: 'POST', body: adj }), 'Balance adjusted', () => open(detail.id))}>
              Adjust balance
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function KycQueue() {
  const [status, setStatus] = useState('PENDING');
  const list = useApi<any[]>(`/api/admin/kyc?status=${status}`);
  const act = useAction();
  const decide = (id: string, decision: 'APPROVED' | 'REJECTED') => {
    const note = decision === 'REJECTED' ? prompt('Reason for rejection?') ?? undefined : undefined;
    act(() => api(`/api/admin/kyc/${id}`, { method: 'POST', body: { decision, note } }), `KYC ${decision.toLowerCase()}`, list.reload);
  };
  return (
    <div className="space-y-3">
      <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
      </select>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <Th cols={['Submitted', 'User', 'Full name', 'DOB', 'Country', 'ID', '']} />
          <tbody>
            {list.data?.map((k) => (
              <tr key={k.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2 text-xs text-muted">{fmtDateTime(k.createdAt)}</td>
                <td className="px-4">{k.user.email}</td>
                <td className="px-4">{k.fullName}</td>
                <td className="px-4 text-xs">{k.dateOfBirth}</td>
                <td className="px-4 text-xs">{k.country}</td>
                <td className="px-4 text-xs">{k.idType} · <span className="num">{k.idNumber}</span></td>
                <td className="whitespace-nowrap px-4 text-right text-xs">
                  {k.status === 'PENDING' ? (
                    <>
                      <button className="mr-3 text-up" onClick={() => decide(k.id, 'APPROVED')}>Approve</button>
                      <button className="text-down" onClick={() => decide(k.id, 'REJECTED')}>Reject</button>
                    </>
                  ) : <StatusBadge status={k.status} />}
                </td>
              </tr>
            ))}
            {!list.data?.length && <tr><td colSpan={7} className="p-8 text-center text-muted">Nothing here</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Withdrawals() {
  const [status, setStatus] = useState('PENDING_APPROVAL');
  const list = useApi<any[]>(`/api/admin/withdrawals?status=${status}`);
  const act = useAction();
  return (
    <div className="space-y-3">
      <select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
        {['PENDING_APPROVAL', 'AWAITING_EMAIL', 'COMPLETED', 'REJECTED', 'CANCELED'].map((s) => <option key={s}>{s}</option>)}
      </select>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <Th cols={['Requested', 'User', 'Asset', 'Amount', 'Fee', 'Network', 'Address', '']} />
          <tbody>
            {list.data?.map((w) => (
              <tr key={w.id} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2 text-xs text-muted">{fmtDateTime(w.createdAt)}</td>
                <td className="px-4">{w.user.email}</td>
                <td className="px-4 font-medium">{w.asset}</td>
                <td className="num px-4">{fmtQty(w.amount, 8)}</td>
                <td className="num px-4 text-muted">{fmtQty(w.fee, 8)}</td>
                <td className="px-4 text-xs">{w.network}</td>
                <td className="num max-w-[220px] truncate px-4 text-xs" title={w.address}>{w.address}</td>
                <td className="whitespace-nowrap px-4 text-right text-xs">
                  {w.status === 'PENDING_APPROVAL' ? (
                    <>
                      <button className="mr-3 text-up" onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}`, { method: 'POST', body: { decision: 'APPROVE' } }), 'Withdrawal approved', list.reload)}>Approve</button>
                      <button className="text-down" onClick={() => act(() => api(`/api/admin/withdrawals/${w.id}`, { method: 'POST', body: { decision: 'REJECT', note: prompt('Reason?') ?? undefined } }), 'Withdrawal rejected', list.reload)}>Reject</button>
                    </>
                  ) : <StatusBadge status={w.status} />}
                </td>
              </tr>
            ))}
            {!list.data?.length && <tr><td colSpan={8} className="p-8 text-center text-muted">Nothing here</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Markets() {
  const pairs = useApi<any[]>('/api/admin/pairs');
  const act = useAction();
  const [edit, setEdit] = useState<Record<string, { makerFee: string; takerFee: string }>>({});
  const [adding, setAdding] = useState(false);
  const [np, setNp] = useState({ base: '', name: '', pricePrecision: '2', qtyPrecision: '4', makerFee: '0.001', takerFee: '0.001' });
  return (
    <div className="space-y-3">
      <button className="btn-brand" onClick={() => setAdding(true)}>+ List new pair</button>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <Th cols={['Pair', 'Price dp', 'Qty dp', 'Maker fee', 'Taker fee', 'Status', '']} />
          <tbody>
            {pairs.data?.map((p) => {
              const e = edit[p.symbol] ?? { makerFee: p.makerFee, takerFee: p.takerFee };
              const dirty = e.makerFee !== p.makerFee || e.takerFee !== p.takerFee;
              return (
                <tr key={p.symbol} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-2 font-medium">{p.base}/{p.quote}</td>
                  <td className="px-4">{p.pricePrecision}</td>
                  <td className="px-4">{p.qtyPrecision}</td>
                  <td className="px-4"><input className="input num w-24 py-1" value={e.makerFee} onChange={(ev) => setEdit({ ...edit, [p.symbol]: { ...e, makerFee: ev.target.value } })} /></td>
                  <td className="px-4"><input className="input num w-24 py-1" value={e.takerFee} onChange={(ev) => setEdit({ ...edit, [p.symbol]: { ...e, takerFee: ev.target.value } })} /></td>
                  <td className="px-4"><StatusBadge status={p.enabled ? 'APPROVED' : 'CANCELED'} /></td>
                  <td className="whitespace-nowrap px-4 text-right text-xs">
                    {dirty && <button className="mr-3 text-brand" onClick={() => act(() => api(`/api/admin/pairs/${p.symbol}`, { method: 'PATCH', body: e }), 'Fees updated', pairs.reload)}>Save fees</button>}
                    <button className={p.enabled ? 'text-down' : 'text-up'} onClick={() => act(() => api(`/api/admin/pairs/${p.symbol}`, { method: 'PATCH', body: { enabled: !p.enabled } }), p.enabled ? 'Trading halted' : 'Trading enabled', pairs.reload)}>
                      {p.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Fees are fractions (0.001 = 0.1%). Disabling a pair halts new orders; users can still cancel.</p>
      <Modal open={adding} onClose={() => setAdding(false)} title="List a new USDT pair">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Base symbol"><input className="input" placeholder="e.g. NEAR" value={np.base} onChange={(e) => setNp({ ...np, base: e.target.value.toUpperCase() })} /></Field>
            <Field label="Asset name"><input className="input" placeholder="NEAR Protocol" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
            <Field label="Price decimals"><input className="input" value={np.pricePrecision} onChange={(e) => setNp({ ...np, pricePrecision: e.target.value })} /></Field>
            <Field label="Quantity decimals"><input className="input" value={np.qtyPrecision} onChange={(e) => setNp({ ...np, qtyPrecision: e.target.value })} /></Field>
            <Field label="Maker fee"><input className="input" value={np.makerFee} onChange={(e) => setNp({ ...np, makerFee: e.target.value })} /></Field>
            <Field label="Taker fee"><input className="input" value={np.takerFee} onChange={(e) => setNp({ ...np, takerFee: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-muted">The pair must exist on the reference market so the market maker can quote it.</p>
          <button className="btn-brand w-full" onClick={() => act(() => api('/api/admin/pairs', { method: 'POST', body: np }), 'Pair listed', () => { setAdding(false); pairs.reload(); })}>List pair</button>
        </div>
      </Modal>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const logs = useApi<any[]>(`/api/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  return (
    <div className="space-y-3">
      <input className="input max-w-sm" placeholder="Filter by action (e.g. withdraw, login_failed, admin.)" value={action} onChange={(e) => setAction(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-xs">
          <Th cols={['Time', 'User', 'Action', 'IP', 'Details']} />
          <tbody>
            {logs.data?.map((l) => (
              <tr key={l.id} className="border-b border-line/50 last:border-0">
                <td className="num px-4 py-2 text-muted">{fmtDateTime(l.createdAt)}</td>
                <td className="px-4">{l.user?.email ?? '—'}</td>
                <td className="px-4 font-medium">{l.action}</td>
                <td className="num px-4 text-muted">{l.ip}</td>
                <td className="num max-w-[360px] truncate px-4 text-muted" title={JSON.stringify(l.meta)}>{l.meta ? JSON.stringify(l.meta) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <RequireAuth admin>
      <div className="mx-auto max-w-[1300px] px-4 py-8">
        <h1 className="mb-4 text-2xl font-bold">Admin</h1>
        <Tabs<Tab>
          className="mb-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'users', label: 'Users' },
            { id: 'kyc', label: 'KYC' },
            { id: 'withdrawals', label: 'Withdrawals' },
            { id: 'markets', label: 'Markets & fees' },
            { id: 'audit', label: 'Audit log' },
          ]}
        />
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'users' && <Users />}
        {tab === 'kyc' && <KycQueue />}
        {tab === 'withdrawals' && <Withdrawals />}
        {tab === 'markets' && <Markets />}
        {tab === 'audit' && <Audit />}
      </div>
    </RequireAuth>
  );
}
