import { config } from '../config.js';
import { prisma } from '../db.js';
import { demoCustody } from './demo.js';
import { fireblocksCustody } from './fireblocks.js';
import type { CustodyProvider } from './types.js';

export const custody: CustodyProvider = config.custodyProvider === 'fireblocks' ? fireblocksCustody : demoCustody;

/** Returns the user's deposit address for asset/network, creating it at the custodian on first use. */
export async function getOrCreateDepositAddress(userId: string, asset: string, network: string) {
  const existing = await prisma.depositAddress.findUnique({ where: { userId_asset_network: { userId, asset, network } } });
  if (existing) return existing;
  const r = await custody.createDepositAddress(userId, asset, network);
  return prisma.depositAddress.upsert({
    where: { userId_asset_network: { userId, asset, network } },
    create: { userId, asset, network, address: r.address, tag: r.tag ?? null, provider: custody.name, providerRef: r.providerRef ?? null },
    update: {},
  });
}
