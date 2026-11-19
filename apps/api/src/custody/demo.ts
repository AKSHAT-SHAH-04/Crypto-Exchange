/** Paper-trading custody: deterministic fake addresses, withdrawals "complete" instantly. Never used in live mode. */
import { sha256 } from '../lib/crypto.js';
import type { CustodyProvider } from './types.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fakeAddress(seed: string, network: string) {
  const h = sha256(seed) + sha256(seed + '2');
  const b58 = (n: number) => Array.from({ length: n }, (_, i) => B58[parseInt(h.slice(i * 2, i * 2 + 2), 16) % 58]).join('');
  switch (network) {
    case 'BTC': return `bc1q${h.slice(0, 38)}`;
    case 'TRC20': return `T${b58(33)}`;
    case 'SOL': return b58(44);
    case 'XRP': return `r${b58(33)}`;
    default: return `0x${h.slice(0, 40)}`;
  }
}

export const demoCustody: CustodyProvider = {
  name: 'demo',
  synchronous: true,
  async createDepositAddress(userId, asset, network) {
    return { address: fakeAddress(`${userId}:${asset}:${network}`, network) };
  },
  async sendWithdrawal(w) {
    return { providerRef: `demo:${w.id}`, txHash: `0x${sha256(w.id + Date.now())}` };
  },
};
