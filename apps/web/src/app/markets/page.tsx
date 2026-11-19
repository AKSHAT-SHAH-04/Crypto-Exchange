import { MarketTable } from '@/components/MarketTable';

export const metadata = { title: 'Markets' };

export default function MarketsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Markets</h1>
      <MarketTable />
    </div>
  );
}
