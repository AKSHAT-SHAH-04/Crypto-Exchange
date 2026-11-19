export interface Ticker {
  symbol: string; price: number; open: number; high: number; low: number;
  change: number; changePct: number; volume: number; quoteVolume: number; updatedAt: number;
}
export interface Market {
  symbol: string; base: string; quote: string; pricePrecision: number; qtyPrecision: number;
  minNotional: string; makerFee: string; takerFee: string; enabled: boolean; ticker: Ticker | null;
}
export interface Depth { symbol: string; bids: [string, string][]; asks: [string, string][]; ts: number }
export interface MarketTrade { id: string; price: number; qty: number; side: 'BUY' | 'SELL'; time: number }
export interface User {
  id: string; email: string; name: string | null; role: 'USER' | 'ADMIN'; emailVerified: boolean;
  totpEnabled: boolean; kycStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'; hasPassword: boolean; createdAt: string;
  isSubAccount: boolean; subLabel: string | null; actingFrom: string | null; payFeesWithToken: boolean;
}
export interface Notification { id: string; type: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }
export interface Announcement { id: string; title: string; body: string; category: string; pinned: boolean; createdAt: string }
export interface Order {
  id: string; symbol: string; side: 'BUY' | 'SELL'; type: 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'TRAILING_STOP';
  ocoId: string | null; trailingDelta: string | null;
  status: 'PENDING_TRIGGER' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED';
  price: string | null; stopPrice: string | null; quantity: string; filledQty: string; quoteFilled: string;
  avgPrice: string | null; createdAt: string; updatedAt: string;
}
export interface MyTrade {
  id: string; symbol: string; side: 'BUY' | 'SELL'; price: string; quantity: string; quote: string;
  fee: string; feeAsset: 'BASE' | 'QUOTE'; role: 'MAKER' | 'TAKER'; createdAt: string;
}
export interface BalanceRow { asset: string; name: string; available: string; locked: string; usdPrice: number; usdValue: number }
export interface Asset { symbol: string; name: string; precision: number; networks: string[]; minWithdraw: string; withdrawFee: string; usdPrice: number }
export interface Tx {
  id: string; type: 'DEPOSIT' | 'WITHDRAWAL' | 'BONUS' | 'ADJUSTMENT' | 'TRANSFER' | 'P2P' | 'CONVERT';
  status: 'AWAITING_EMAIL' | 'PENDING_APPROVAL' | 'COMPLETED' | 'REJECTED' | 'CANCELED';
  asset: string; network: string | null; amount: string; fee: string; address: string | null; txHash: string | null; note: string | null; createdAt: string;
}
