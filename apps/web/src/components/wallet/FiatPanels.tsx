'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Modal } from '@/components/Modal';
import { Field, StatusBadge } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmt, fmtDateTime, fmtQty } from '@/lib/format';

interface FiatCur { currency: string; country: string; available: boolean; bankConfigured: boolean; depositFee: string; withdrawFee: string; minWithdraw: string }
interface BankAcct { id: string; currency: string; label: string; holder: string; display: string }

const BANK_FIELDS: Record<string, [string, string][]> = {
  AED: [['iban', 'IBAN (AE + 21 digits)'], ['swift', 'SWIFT / BIC (optional)'], ['bankName', 'Bank name']],
  INR: [['accountNumber', 'Account number'], ['ifsc', 'IFSC'], ['bankName', 'Bank name']],
  USD: [['routingNumber', 'ACH routing number'], ['accountNumber', 'Account number'], ['bankName', 'Bank name']],
};

function KycGate() {
  return (
    <p className="rounded-md bg-brand/10 px-3 py-2 text-sm">
      Bank deposits and withdrawals open after identity verification. <Link href="/account?tab=kyc" className="text-brand underline">Verify now</Link>
    </p>
  );
}

export function FiatDepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const curs = useApi<FiatCur[]>(open ? '/api/fiat/currencies' : null);
  const mine = curs.data?.find((c) => c.available);
  const info = useApi<any>(open && mine ? `/api/fiat/deposit/${mine.currency}` : null);
  const copy = (v: string) => navigator.clipboard?.writeText(v).then(() => toast('Copied', 'success'));
  return (
    <Modal open={open} onClose={onClose} title={`Deposit ${mine?.currency ?? 'cash'} by bank transfer`}>
      {!curs.data ? (
        <p className="text-muted">Loading…</p>
      ) : !mine ? (
        <KycGate />
      ) : !info.data ? (
        <p className="text-muted">Loading…</p>
      ) : !info.data.available ? (
        <p className="text-sm text-muted">{info.data.message}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-up/10 px-3 py-2 text-up">Bank deposits are free — no fees from us.</p>
          <dl className="divide-y divide-line rounded-md border border-line">
            {[
              ['Bank', info.data.bank.bankName],
              ['Account name', info.data.bank.accountName],
              [mine.currency === 'AED' ? 'IBAN' : 'Account number', info.data.bank.accountNumber],
              [mine.currency === 'AED' ? 'SWIFT' : mine.currency === 'INR' ? 'IFSC' : 'Routing number', info.data.bank.routingCode],
              ['Reference (required)', info.data.reference],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 px-3 py-2">
                <dt className="w-36 shrink-0 text-xs text-muted">{k}</dt>
                <dd className={clsx('num min-w-0 flex-1 break-all', k.startsWith('Reference') && 'font-bold text-brand')}>{v}</dd>
                <button className="text-xs text-brand" onClick={() => copy(v)}>Copy</button>
              </div>
            ))}
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            {info.data.notes.map((n: string) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export function FiatWithdrawModal({ open, onClose, balances }: { open: boolean; onClose: () => void; balances: { asset: string; available: string }[] }) {
  const { user } = useAuth();
  const toast = useToast();
  const curs = useApi<FiatCur[]>(open ? '/api/fiat/currencies' : null);
  const mine = curs.data?.find((c) => c.available);
  const accts = useApi<BankAcct[]>(open && mine ? '/api/fiat/bank-accounts' : null);
  const list = (accts.data ?? []).filter((a) => a.currency === mine?.currency);
  const [acctId, setAcctId] = useState('');
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [na, setNa] = useState<{ label: string; holder: string; details: Record<string, string> }>({ label: '', holder: '', details: {} });
  const [busy, setBusy] = useState(false);
  useEffect(() => setAcctId(list[0]?.id ?? ''), [accts.data]); // eslint-disable-line
  const avail = +(balances.find((b) => b.asset === mine?.currency)?.available ?? 0);

  const addAcct = async () => {
    try {
      await api('/api/fiat/bank-accounts', { method: 'POST', body: { currency: mine!.currency, ...na, code: code || undefined } });
      toast('Bank account added', 'success');
      setAdding(false);
      setNa({ label: '', holder: '', details: {} });
      accts.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/fiat/withdraw', { method: 'POST', body: { bankAccountId: acctId, amount, code: code || undefined } });
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
    <Modal open={open} onClose={onClose} title={`Withdraw ${mine?.currency ?? 'cash'} to bank`}>
      {!curs.data ? (
        <p className="text-muted">Loading…</p>
      ) : !mine ? (
        <KycGate />
      ) : (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between">
              <span className="label">Your bank account</span>
              <button className="text-xs text-brand" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : '+ Add bank account'}</button>
            </div>
            {adding ? (
              <div className="space-y-2 rounded-md border border-line p-3">
                <input className="input" placeholder="Label (e.g. Salary account)" value={na.label} onChange={(e) => setNa({ ...na, label: e.target.value })} />
                <input className="input" placeholder="Account holder (must match your ID)" value={na.holder} onChange={(e) => setNa({ ...na, holder: e.target.value })} />
                {mine.currency === 'USD' && (
                  <select className="input" value={na.details.accountType ?? ''} onChange={(e) => setNa({ ...na, details: { ...na.details, accountType: e.target.value } })}>
                    <option value="">Account type</option><option value="checking">Checking</option><option value="savings">Savings</option>
                  </select>
                )}
                {BANK_FIELDS[mine.currency].map(([k, ph]) => (
                  <input key={k} className="input num" placeholder={ph} value={na.details[k] ?? ''} onChange={(e) => setNa({ ...na, details: { ...na.details, [k]: e.target.value.trim() } })} />
                ))}
                {user?.totpEnabled && <input className="input num" placeholder="2FA code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
                <button className="btn-brand w-full" onClick={addAcct} disabled={!na.label || !na.holder}>Save bank account</button>
              </div>
            ) : list.length ? (
              <div className="space-y-1">
                {list.map((a) => (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-brand">
                    <input type="radio" checked={acctId === a.id} onChange={() => setAcctId(a.id)} />
                    <span className="flex-1"><b>{a.label}</b> <span className="text-xs text-muted">{a.display} · {a.holder}</span></span>
                    <button className="text-xs text-down" onClick={(e) => { e.preventDefault(); api(`/api/fiat/bank-accounts/${a.id}`, { method: 'DELETE' }).then(accts.reload); }}>Remove</button>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Add a bank account in your own name to withdraw.</p>
            )}
          </div>
          <Field label={`Amount (${mine.currency})`} hint={`Available ${fmt(avail, 2)} · Fee ${fmt(mine.withdrawFee, 2)} · Min ${fmt(mine.minWithdraw, 2)}`}>
            <div className="flex gap-2">
              <input className="input num" inputMode="decimal" value={amount} onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setAmount(e.target.value)} />
              <button className="btn-ghost shrink-0" onClick={() => setAmount(String(Math.floor(avail * 100) / 100))}>Max</button>
            </div>
          </Field>
          {user?.totpEnabled && !adding && <Field label="2FA code"><input className="input num" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>}
          {+amount > 0 && <p className="text-sm text-muted">You will receive <b className="num text-fg">{fmt(Math.max(0, +amount - +mine.withdrawFee), 2)} {mine.currency}</b></p>}
          <button className="btn-brand w-full" disabled={busy || !acctId || !+amount || adding} onClick={submit}>Withdraw</button>
        </div>
      )}
    </Modal>
  );
}

const RAMP_PAIRS = ['USDT:TRC20', 'USDT:ERC20', 'BTC:BTC', 'ETH:ERC20', 'SOL:SOL'];

export function RampModal({ open, onClose, side }: { open: boolean; onClose: () => void; side: 'BUY' | 'SELL' }) {
  const toast = useToast();
  const cfg = useApi<{ enabled: boolean; provider: string | null; fiat: string }>(open ? '/api/ramp/config' : null);
  const [pair, setPair] = useState('USDT:TRC20');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const [asset, network] = pair.split(':');
    try {
      const r = await api<{ url: string }>('/api/ramp/session', { method: 'POST', body: { side, asset, network, fiatCurrency: cfg.data!.fiat, amount: amount || undefined } });
      window.open(r.url, '_blank', 'noopener,noreferrer');
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={side === 'BUY' ? 'Buy crypto with card / Apple Pay' : 'Sell crypto to card / bank'}>
      {!cfg.data ? (
        <p className="text-muted">Loading…</p>
      ) : !cfg.data.enabled ? (
        <p className="text-sm text-muted">Card and Apple Pay purchases are coming soon. Meanwhile, deposit by bank transfer (free) or use P2P.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <Field label="Coin & network">
            <select className="input" value={pair} onChange={(e) => setPair(e.target.value)}>
              {RAMP_PAIRS.map((p) => <option key={p} value={p}>{p.replace(':', ' · ')}</option>)}
            </select>
          </Field>
          <Field label={side === 'BUY' ? `Spend (${cfg.data.fiat})` : `Sell amount (${pair.split(':')[0]})`}>
            <input className="input num" inputMode="decimal" value={amount} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)} />
          </Field>
          <p className="text-xs text-muted">
            You&apos;ll continue on our payment partner&apos;s secure page. We compare licensed providers and show you the lowest-fee offer for your
            country and payment method. {side === 'BUY' ? 'Crypto arrives in your wallet after on-chain confirmation.' : "After you confirm, you'll approve the transfer here with 2FA."}
          </p>
          <p className="rounded-md bg-up/10 px-3 py-2 text-xs text-up">Tip: bank transfer deposits are free and usually cheaper than cards.</p>
          <button className="btn-brand w-full" disabled={busy} onClick={start}>Continue to partner</button>
        </div>
      )}
    </Modal>
  );
}

export function RampOrders() {
  const toast = useToast();
  const { user } = useAuth();
  const orders = useApi<any[]>('/api/ramp/orders', { refreshOnUserEvent: true });
  const [code, setCode] = useState('');
  if (!orders.data?.length) return null;
  const send = async (id: string) => {
    try {
      await api(`/api/ramp/orders/${id}/send`, { method: 'POST', body: { code } });
      toast('Transfer submitted for processing', 'success');
      orders.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <div className="card overflow-x-auto">
      <h2 className="border-b border-line px-4 py-3 font-semibold">Card & partner orders</h2>
      <table className="w-full min-w-[640px] text-xs">
        <thead><tr className="border-b border-line">{['Date', 'Type', 'Coin', 'Fiat', 'Crypto', 'Partner', 'Status', ''].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
        <tbody>
          {orders.data.map((o) => (
            <tr key={o.id} className="border-b border-line/50 last:border-0">
              <td className="num px-4 py-2 text-muted">{fmtDateTime(o.createdAt)}</td>
              <td className={clsx('px-4 font-medium', o.side === 'BUY' ? 'text-up' : 'text-down')}>{o.side.toLowerCase()}</td>
              <td className="px-4">{o.asset} <span className="text-muted">{o.network}</span></td>
              <td className="num px-4">{o.fiatAmount ? `${fmt(o.fiatAmount, 2)} ${o.fiatCurrency}` : '—'}</td>
              <td className="num px-4">{o.cryptoAmount ? fmtQty(o.cryptoAmount, 8) : '—'}</td>
              <td className="px-4 capitalize">{o.provider}</td>
              <td className="px-4"><StatusBadge status={o.status} /></td>
              <td className="whitespace-nowrap px-4 text-right">
                {o.side === 'SELL' && o.walletAddress && o.cryptoAmount && !['FUNDING', 'COMPLETED'].includes(o.status) && (
                  <span className="flex items-center justify-end gap-1">
                    {user?.totpEnabled && <input className="input num w-20 py-1 text-xs" placeholder="2FA" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
                    <button className="text-brand" onClick={() => send(o.id)}>Send {o.asset}</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
