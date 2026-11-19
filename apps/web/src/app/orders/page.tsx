'use client';
import { RequireAuth } from '@/components/RequireAuth';
import { UserOrders } from '@/components/trade/UserOrders';

export default function OrdersPage() {
  return (
    <RequireAuth>
      <div className="mx-auto max-w-[1200px] px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">Orders</h1>
        <UserOrders full />
      </div>
    </RequireAuth>
  );
}
