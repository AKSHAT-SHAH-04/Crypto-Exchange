export interface DepositAddressResult {
  address: string;
  tag?: string | null;
  providerRef?: string | null;
}

export interface WithdrawalRequest {
  /** Our Transaction id — passed to the custodian as an idempotency key */
  id: string;
  asset: string;
  network: string;
  /** Net amount to send on-chain (gross minus our withdrawal fee) */
  amount: string;
  address: string;
  tag?: string | null;
}

export interface CustodyProvider {
  readonly name: string;
  /** Whether sendWithdrawal completes synchronously (demo) or via later webhooks (real custodians). */
  readonly synchronous: boolean;
  createDepositAddress(userId: string, asset: string, network: string): Promise<DepositAddressResult>;
  sendWithdrawal(w: WithdrawalRequest): Promise<{ providerRef: string; txHash?: string }>;
}
