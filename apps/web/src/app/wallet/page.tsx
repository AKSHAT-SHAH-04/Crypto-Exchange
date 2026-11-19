'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { RequireAuth } from '@/components/RequireAuth';
import { Modal } from '@/components/Modal';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmt, fmtDateTime, fmtQty } from '@/lib/format';
import type { Asset, BalanceRow, Tx } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { FiatDepositModal, FiatWithdrawModal, RampModal, RampOrders } from '@/components/wallet/FiatPanels';

const FIAT = ['AED', 'INR', 'USD'];
const COLORS = ['#7c5cff', '#16c784', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#a3a3a3'];

function DepositModal({ open, onClose, assets, initial }: { open: boolean; onClose: () => void; assets: Asset[]; initial?: string }) {
  const { tradingMode } = useAuth();
  const toast = useToast();
  const [asset, setAsset] = useState(initial || 'USDT');
  const a = assets.find((x) => x.symbol === asset);
  const [network, setNetwork] = useState('');
  const [addr, setAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (initial) setAsset(initial); }, [initial]);
  useEffect(() => { setNetwork(a?.networks[0] ?? ''); }, [a]);
  useEffect(() => {
    setAddr(null);
    if (open && asset && network) api(`/api/wallet/deposit-address?asset=${asset}&network=${network}`).then((r) => setAddr(r.address)).catch(() => {});
  }, [open, asset, network]);

  const demo = async () => {
    setBusy(true);
    try {
      await api('/api/wallet/demo-deposit', { method: 'POST', body: { asset, amount } });
      toast(`Credited ${amount} ${asset} (demo)`, 'success');
      setAmount('');
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Deposit crypto">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Coin">
            <select className="input" value={asset} onChange={(e) => setAsset(e.target.value)}>
              {assets.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol} — {x.name}</option>)}
            </select>
          </Field>
          <Field label="Network">
            <select className="input" value={network} onChange={(e) => setNetwork(e.target.value)}>
              {a?.networks.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Deposit address">
          <div className="flex gap-2">
            <code className="input num break-all text-xs">{addr ?? 'Generating…'}</code>
            <button className="btn-ghost shrink-0" onClick={() => addr && navigator.clipboard?.writeText(addr).then(() => toast('Address copied', 'success'))}>Copy</button>
          </div>
        </Field>
        <p className="rounded-md bg-down/10 px-3 py-2 text-xs text-down">
          {tradingMode === 'paper'
            ? 'Paper trading: this is a demo address. Do NOT send real funds to it — they will be lost.'
            : `Send only ${asset} via ${network} to this address.`}
        </p>
        {tradingMode === 'paper' && (
          <div className="border-t border-line pt-4">
            <div className="mb-2 text-sm font-semibold">Get demo funds instantly</div>
            <div className="flex gap-2">
              <input className="input num" inputMode="decimal" placeholder={`Amount of ${asset}`} value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} />
              <button className="btn-brand shrink-0" onClick={demo} disabled={busy || !+amount}>Credit</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function WithdrawModal({ open, onClose, assets, balances, initial }: { open: boolean; onClose: () => void; assets: Asset[]; balances: BalanceRow[]; initial?: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [asset, setAsset] = useState(initial || 'USDT');
  const a = assets.find((x) => x.symbol === asset);
  const addresses = useApi<{ id: string; asset: string; network: string; address: string; label: string }[]>(open ? '/api/wallet/addresses' : null);
  const mine = (addresses.data ?? []).filter((x) => x.asset === asset);
  const [addressId, setAddressId] = useState('');
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [newAddr, setNewAddr] = useState({ network: '', address: '', label: '' });
  const [busy, setBusy] = useState(false);
  const avail = +(balances.find((b) => b.asset === asset)?.available ?? 0);

  useEffect(() => { if (initial) setAsset(initial); }, [initial]);
  useEffect(() => { setAddressId(mine[0]?.id ?? ''); setNewAddr((n) => ({ ...n, network: a?.networks[0] ?? '' })); }, [asset, addresses.data]); // eslint-disable-line

  const blocker = !user?.emailVerified ? 'Verify your email address to enable withdrawals.' : user.kycStatus !== 'APPROVED' ? 'Complete identity verification (KYC) to enable withdrawals.' : null;

  const add = async () => {
    try {
      await api('/api/wallet/addresses', { method: 'POST', body: { asset, ...newAddr, code: code || undefined } });
      toast('Address added to whitelist', 'success');
      setAdding(false);
      setNewAddr({ network: a?.networks[0] ?? '', address: '', label: '' });
      addresses.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const remove = async (id: string) => {
    await api(`/api/wallet/addresses/${id}`, { method: 'DELETE' }).catch((e) => toast(errMsg(e), 'error'));
    addresses.reload();
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/wallet/withdraw', { method: 'POST', body: { addressId, amount, code: code || undefined } });
      toast('Check your email to confirm this withdrawal', 'success');
      setAmount('');
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Withdraw crypto">
      <div className="space-y-4">
        {blocker && (
          <div className="rounded-md bg-brand/10 px-3 py-2 text-sm">
            {blocker} <Link href="/account" className="text-brand underline">Go to account</Link>
          </div>
        )}
        <Field label="Coin">
          <select className="input" value={asset} onChange={(e) => setAsset(e.target.value)}>
            {assets.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol} — {x.name}</option>)}
          </select>
        </Field>
        <div>
          <div className="mb-1 flex justify-between">
            <span className="label">Whitelisted address</span>
            <button className="text-xs text-brand" onClick={() => setAdding((s) => !s)}>{adding ? 'Cancel' : '+ Add address'}</button>
          </div>
          {adding ? (
            <div className="space-y-2 rounded-md border border-line p-3">
              <select className="input" value={newAddr.network} onChange={(e) => setNewAddr({ ...newAddr, network: e.target.value })}>
                {a?.networks.map((n) => <option key={n}>{n}</option>)}
              </select>
              <input className="input" placeholder="Address" value={newAddr.address} onChange={(e) => setNewAddr({ ...newAddr, address: e.target.value.trim() })} />
              <input className="input" placeholder="Label (e.g. My hardware wallet)" value={newAddr.label} onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })} />
              {user?.totpEnabled && <input className="input" placeholder="2FA code" value={code} onChange={(e) => setCode(e.target.value)} />}
              <button className="btn-brand w-full" onClick={add} disabled={!newAddr.address || !newAddr.label}>Save to whitelist</button>
            </div>
          ) : mine.length ? (
            <div className="space-y-1">
              {mine.map((x) => (
                <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-brand">
                  <input type="radio" checked={addressId === x.id} onChange={() => setAddressId(x.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{x.label}</span> <span className="text-xs text-muted">{x.network}</span>
                    <span className="num block truncate text-xs text-muted">{x.address}</span>
                  </span>
                  <button className="text-xs text-down" onClick={(e) => { e.preventDefault(); remove(x.id); }}>Remove</button>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No whitelisted {asset} addresses yet. For your security, withdrawals can only go to saved addresses.</p>
          )}
        </div>
        <Field label="Amount" hint={a && `Available: ${fmtQty(avail, 8)} ${asset} · Network fee: ${fmtQty(a.withdrawFee, 8)} · Min: ${fmtQty(a.minWithdraw, 8)}`}>
          <div className="flex gap-2">
            <input className="input num" inputMode="decimal" value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} />
            <button className="btn-ghost shrink-0" onClick={() => setAmount(String(avail))}>Max</button>
          </div>
        </Field>
        {user?.totpEnabled && !adding && (
          <Field label="2FA code"><input className="input num" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
        )}
        {a && +amount > 0 && <div className="text-sm text-muted">You will receive <span className="num text-fg">{fmtQty(Math.max(0, +amount - +a.withdrawFee), 8)} {asset}</span></div>}
        <button className="btn-brand w-full" onClick={submit} disabled={!!blocker || busy || !addressId || !+amount}>Withdraw</button>
      </div>
    </Modal>
  );
}

function Wallet() {
  const { t } = useT();
  const toast = useToast();
  const { user, tradingMode } = useAuth();
  const welcome = useSearchParams().get('welcome');
  const bal = useApi<{ totalUsd: number; balances: BalanceRow[] }>('/api/wallet/balances', { refreshOnUserEvent: true });
  const txs = useApi<Tx[]>('/api/wallet/transactions', { refreshOnUserEvent: true });
  const assets = useApi<Asset[]>('/api/wallet/assets');
  const [modal, setModal] = useState<{ kind: 'deposit' | 'withdraw' | 'fiatDeposit' | 'fiatWithdraw' | 'buy' | 'sell'; asset?: string } | null>(null);
  const [hideSmall, setHideSmall] = useState(false);
  const [hidden, setHidden] = useState(false);

  // live revaluation every 5s
  useEffect(() => {
    const t = setInterval(() => bal.reload(), 5000);
    return () => clearInterval(t);
  }, [bal.reload]); // eslint-disable-line

  const rows = (bal.data?.balances ?? []).filter((b) => !hideSmall || b.usdValue >= 1);
  const pie = useMemo(() => {
    const list = (bal.data?.balances ?? []).filter((b) => b.usdValue > 0.01).map((b) => ({ name: b.asset, value: b.usdValue }));
    const top = list.slice(0, 6);
    const rest = list.slice(6).reduce((s, x) => s + x.value, 0);
    return rest > 0 ? [...top, { name: 'Other', value: rest }] : top;
  }, [bal.data]);
  const total = bal.data?.totalUsd ?? 0;

  const cancelWithdrawal = async (id: string) => {
    try {
      await api(`/api/wallet/withdraw/${id}/cancel`, { method: 'POST' });
      toast('Withdrawal canceled', 'success');
      txs.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-8">
      {welcome && tradingMode === 'paper' && (
        <div className="card border-brand/50 p-4 text-sm">
          🎉 Welcome{user?.name ? `, ${user.name}` : ''}! We've credited <b>10,000 demo USDT</b> to your wallet. <Link href="/trade/BTCUSDT" className="text-brand underline">Start trading</Link>
        </div>
      )}
      {user && !user.emailVerified && (
        <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
          Please verify your email address ({user.email}).
          <button className="text-brand underline" onClick={() => api('/api/auth/resend-verification', { method: 'POST' }).then(() => toast('Verification email sent', 'success')).catch((e) => toast(errMsg(e), 'error'))}>Resend email</button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <div className="card p-6">
          <div className="flex items-center gap-2 text-sm text-muted">
            {t('wallet.estimated')}
            <button onClick={() => setHidden((h) => !h)} className="text-xs hover:text-fg">{hidden ? 'Show' : 'Hide'}</button>
          </div>
          <div className="num mt-2 text-3xl font-bold">{hidden ? '******' : `$${fmt(total, 2)}`}</div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button className="btn-brand" onClick={() => setModal({ kind: 'deposit' })}>{t('wallet.deposit')} crypto</button>
            <button className="btn-ghost" onClick={() => setModal({ kind: 'fiatDeposit' })}>Deposit cash</button>
            <button className="btn-ghost" onClick={() => setModal({ kind: 'buy' })}>Buy with card</button>
            {!user?.isSubAccount && <button className="btn-ghost" onClick={() => setModal({ kind: 'withdraw' })}>{t('wallet.withdraw')} crypto</button>}
            {!user?.isSubAccount && <button className="btn-ghost" onClick={() => setModal({ kind: 'fiatWithdraw' })}>Withdraw cash</button>}
            {!user?.isSubAccount && <button className="btn-ghost" onClick={() => setModal({ kind: 'sell' })}>Sell to card</button>}
            <Link href="/convert" className="btn-ghost">{t('nav.convert')}</Link>
            <Link href="/trade/BTCUSDT" className="btn-ghost">{t('nav.trade')}</Link>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <div className="h-[140px] w-[140px] shrink-0">
            {pie.length > 0 && (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2} stroke="none">
                    {pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `$${fmt(v, 2)}`} contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))', borderRadius: 6, fontSize: 12 }} itemStyle={{ color: 'rgb(var(--fg))' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <ul className="min-w-0 flex-1 space-y-1 text-xs">
            {pie.map((p, i) => (
              <li key={p.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="font-medium">{p.name}</span>
                <span className="num ml-auto text-muted">{total ? ((p.value / total) * 100).toFixed(1) : 0}%</span>
              </li>
            ))}
            {!pie.length && <li className="text-muted">No assets yet</li>}
          </ul>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center border-b border-line px-4 py-3">
          <h2 className="font-semibold">{t('wallet.assets')}</h2>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} /> Hide balances under $1
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line">
                {['Coin', 'Total', 'Available', 'In orders', 'Value (USD)', ''].map((h, i) => <th key={h + i} className={`table-head px-4 py-2 ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.asset} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-3"><span className="font-semibold">{b.asset}</span> <span className="text-xs text-muted">{b.name}</span></td>
                  <td className="num px-4 text-right">{hidden ? '***' : fmtQty(+b.available + +b.locked, 8)}</td>
                  <td className="num px-4 text-right">{hidden ? '***' : fmtQty(b.available, 8)}</td>
                  <td className="num px-4 text-right text-muted">{hidden ? '***' : fmtQty(b.locked, 8)}</td>
                  <td className="num px-4 text-right">{hidden ? '***' : `$${fmt(b.usdValue, 2)}`}</td>
                  <td className="whitespace-nowrap px-4 text-right text-xs">
                    <button className="mr-3 text-brand hover:underline" onClick={() => setModal({ kind: FIAT.includes(b.asset) ? 'fiatDeposit' : 'deposit', asset: b.asset })}>Deposit</button>
                    <button className="mr-3 text-brand hover:underline" onClick={() => setModal({ kind: FIAT.includes(b.asset) ? 'fiatWithdraw' : 'withdraw', asset: b.asset })}>Withdraw</button>
                    {FIAT.includes(b.asset) ? <Link className="text-brand hover:underline" href="/convert">Convert</Link> : b.asset !== 'USDT' && <Link className="text-brand hover:underline" href={`/trade/${b.asset}USDT`}>Trade</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <h2 className="flex items-center border-b border-line px-4 py-3 font-semibold">
          {t('wallet.history')}
          <a href="/api/export/transactions" download className="ml-auto text-xs font-normal text-brand">{t('wallet.export')}</a>
        </h2>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-line">
                {['Date', 'Type', 'Coin', 'Amount', 'Network', 'Address / TxID', 'Status', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {txs.data?.map((tx) => (
                <tr key={tx.id} className="border-b border-line/50 last:border-0">
                  <td className="num px-4 py-2 text-muted">{fmtDateTime(tx.createdAt)}</td>
                  <td className="px-4">{tx.type.toLowerCase()}</td>
                  <td className="px-4 font-medium">{tx.asset}</td>
                  <td className={`num px-4 ${tx.type === 'WITHDRAWAL' || +tx.amount < 0 ? 'text-down' : 'text-up'}`}>{tx.type === 'WITHDRAWAL' || +tx.amount < 0 ? '-' : '+'}{fmtQty(Math.abs(+tx.amount), 8)}</td>
                  <td className="px-4 text-muted">{tx.network ?? '—'}</td>
                  <td className="num max-w-[200px] truncate px-4 text-muted" title={tx.txHash || tx.address || tx.note || ''}>{tx.txHash || tx.address || tx.note || '—'}</td>
                  <td className="px-4"><StatusBadge status={tx.status} /></td>
                  <td className="px-4 text-right">
                    {tx.type === 'WITHDRAWAL' && ['AWAITING_EMAIL', 'PENDING_APPROVAL'].includes(tx.status) && (
                      <button className="text-brand hover:underline" onClick={() => cancelWithdrawal(tx.id)}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {!txs.data?.length && <tr><td colSpan={8} className="p-8 text-center text-muted">No transactions yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <RampOrders />
      <FiatDepositModal open={modal?.kind === 'fiatDeposit'} onClose={() => setModal(null)} />
      <FiatWithdrawModal open={modal?.kind === 'fiatWithdraw'} onClose={() => setModal(null)} balances={bal.data?.balances ?? []} />
      <RampModal open={modal?.kind === 'buy' || modal?.kind === 'sell'} side={modal?.kind === 'sell' ? 'SELL' : 'BUY'} onClose={() => setModal(null)} />
      <DepositModal open={modal?.kind === 'deposit'} onClose={() => setModal(null)} assets={(assets.data ?? []).filter((a) => !FIAT.includes(a.symbol))} initial={modal?.asset} />
      <WithdrawModal open={modal?.kind === 'withdraw'} onClose={() => setModal(null)} assets={assets.data ?? []} balances={bal.data?.balances ?? []} initial={modal?.asset} />
    </div>
  );
}

export default function WalletPage() {
  return (
    <RequireAuth>
      <Suspense>
        <Wallet />
      </Suspense>
    </RequireAuth>
  );
}
