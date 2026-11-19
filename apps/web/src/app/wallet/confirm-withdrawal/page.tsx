'use client';
import { Suspense } from 'react';
import { TokenAction } from '@/components/TokenAction';

export default function Page() {
  return (
    <Suspense>
      <TokenAction endpoint="/api/wallet/withdraw/confirm" title="Confirm withdrawal" success="Withdrawal confirmed. It's now awaiting review and will be processed shortly." />
    </Suspense>
  );
}
