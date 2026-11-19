/**
 * The house account. Trading fees and withdrawal fees accrue here, and in live mode Convert trades
 * against its inventory, so: sum(user balances) + treasury == assets held at the custodian/bank.
 */
import { prisma } from '../db.js';

const TREASURY_EMAIL = 'treasury@system.internal';
let treasuryId: string | null = null;

export async function initTreasury() {
  const u = await prisma.user.upsert({
    where: { email: TREASURY_EMAIL },
    create: { email: TREASURY_EMAIL, name: 'Treasury', role: 'SYSTEM', emailVerified: true },
    update: {},
  });
  treasuryId = u.id;
  return u.id;
}

export function getTreasuryId() {
  if (!treasuryId) throw new Error('Treasury not initialised');
  return treasuryId;
}
