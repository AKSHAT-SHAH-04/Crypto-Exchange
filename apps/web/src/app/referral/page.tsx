'use client';
import { RequireAuth } from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { useApi } from '@/lib/hooks';
import { brand, fmt, fmtDateTime, fmtQty } from '@/lib/format';

interface Referral {
  code: string; link: string; commissionRate: number;
  stats: { friends: number; trading: number; totalUsd: number; byAsset: { asset: string; amount: string; usd: number }[] };
  referees: { id: string; email: string; joinedAt: string; verified: boolean; earnedUsd: number }[];
  recent: { id: string; asset: string; amount: string; usd: number; createdAt: string }[];
}

function ReferralView() {
  const toast = useToast();
  const r = useApi<Referral>('/api/referral', { refreshOnUserEvent: true });
  const copy = (v: string, what: string) => navigator.clipboard?.writeText(v).then(() => toast(`${what} copied`, 'success'));
  const share = async () => {
    if (!r.data) return;
    const text = `Join me on ${brand} — trade crypto with free bank deposits and low fees.`;
    if (navigator.share) await navigator.share({ title: brand, text, url: r.data.link }).catch(() => {});
    else copy(r.data.link, 'Link');
  };
  if (!r.data) return <div className="p-10 text-center text-muted">{r.error ?? 'Loading…'}</div>;
  const d = r.data;
  const rate = Math.round(d.commissionRate * 100);

  return (
    <div>
      <section className="bg-section px-6 py-16 text-center">
        <div className="eyebrow">Referral program</div>
        <h1 className="headline mx-auto mt-3 max-w-3xl text-5xl sm:text-6xl">Invite friends.<br />Earn {rate}% of their fees.</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Every time someone you invite trades, {rate}% of the trading fee they pay goes straight to your wallet — for as long as they trade.</p>
        <div className="mx-auto mt-10 max-w-xl rounded-3xl bg-panel p-6 text-left shadow-sm">
          <div className="text-xs text-muted">Your referral link</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="num min-w-0 flex-1 truncate rounded-xl bg-panel2 px-3 py-2.5 text-sm">{d.link}</code>
            <button className="btn-brand shrink-0" onClick={share}>Share</button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted">Code</span>
            <b className="num tracking-widest">{d.code}</b>
            <button className="text-xs text-brand" onClick={() => copy(d.code, 'Code')}>Copy</button>
            <button className="ml-auto text-xs text-brand" onClick={() => copy(d.link, 'Link')}>Copy link</button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1000px] space-y-8 px-4 py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ['Friends invited', String(d.stats.friends)],
            ['Friends trading', String(d.stats.trading)],
            ['Total earned', `$${fmt(d.stats.totalUsd, 2)}`],
          ].map(([k, v]) => (
            <div key={k} className="card p-6"><div className="text-xs text-muted">{k}</div><div className="num headline mt-1 text-3xl">{v}</div></div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['1', 'Share your link', 'Send it to friends or post it anywhere.'],
            ['2', 'They sign up and trade', 'They create an account with your link and start trading.'],
            ['3', `You earn ${rate}%`, 'Your share of their fees lands in your wallet instantly, in the coin they paid it in.'],
          ].map(([n, t, b]) => (
            <div key={n} className="rounded-3xl bg-section p-6">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{n}</div>
              <div className="mt-4 font-semibold">{t}</div>
              <p className="mt-1 text-sm text-muted">{b}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-4 font-semibold">Your friends</h2>
            <ul className="divide-y divide-line/60 text-sm">
              {d.referees.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 truncate">{f.email}</span>
                  <span className="text-xs text-muted">{f.verified ? 'Verified' : 'Not verified'}</span>
                  <span className="num w-20 text-right text-up">${fmt(f.earnedUsd, 2)}</span>
                </li>
              ))}
              {!d.referees.length && <li className="p-8 text-center text-muted">No friends yet — share your link to get started.</li>}
            </ul>
          </div>
          <div className="card overflow-hidden">
            <h2 className="border-b border-line px-5 py-4 font-semibold">Recent commissions</h2>
            <ul className="divide-y divide-line/60 text-sm">
              {d.recent.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="num flex-1 text-muted">{fmtDateTime(x.createdAt)}</span>
                  <span className="num">+{fmtQty(x.amount, 8)} {x.asset}</span>
                </li>
              ))}
              {!d.recent.length && <li className="p-8 text-center text-muted">Commissions appear here as your friends trade.</li>}
            </ul>
          </div>
        </div>
        <p className="text-xs text-muted">Commission is {rate}% of the trading fee paid by each referred account and is credited in the asset the fee was paid in. Self-referrals and abuse void rewards.</p>
      </div>
    </div>
  );
}

export default function Page() {
  return <RequireAuth><ReferralView /></RequireAuth>;
}
