import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const D = Prisma.Decimal;

const assets = [
  { symbol: 'USDT', name: 'Tether', precision: 6, networks: ['TRC20', 'ERC20', 'BEP20'], minWithdraw: 10, withdrawFee: 1 },
  { symbol: 'BTC', name: 'Bitcoin', precision: 8, networks: ['BTC', 'BEP20'], minWithdraw: 0.0005, withdrawFee: 0.0002 },
  { symbol: 'ETH', name: 'Ethereum', precision: 8, networks: ['ERC20', 'BEP20'], minWithdraw: 0.005, withdrawFee: 0.001 },
  { symbol: 'BNB', name: 'BNB', precision: 8, networks: ['BEP20'], minWithdraw: 0.01, withdrawFee: 0.0005 },
  { symbol: 'SOL', name: 'Solana', precision: 8, networks: ['SOL'], minWithdraw: 0.1, withdrawFee: 0.01 },
  { symbol: 'XRP', name: 'XRP', precision: 6, networks: ['XRP'], minWithdraw: 20, withdrawFee: 0.25 },
  { symbol: 'DOGE', name: 'Dogecoin', precision: 8, networks: ['BEP20'], minWithdraw: 50, withdrawFee: 4 },
  { symbol: 'ADA', name: 'Cardano', precision: 6, networks: ['BEP20'], minWithdraw: 10, withdrawFee: 1 },
  { symbol: 'AVAX', name: 'Avalanche', precision: 8, networks: ['BEP20'], minWithdraw: 0.2, withdrawFee: 0.01 },
  { symbol: 'LINK', name: 'Chainlink', precision: 8, networks: ['ERC20', 'BEP20'], minWithdraw: 1, withdrawFee: 0.1 },
  { symbol: 'DOT', name: 'Polkadot', precision: 8, networks: ['BEP20'], minWithdraw: 2, withdrawFee: 0.1 },
  { symbol: 'LTC', name: 'Litecoin', precision: 8, networks: ['BEP20'], minWithdraw: 0.05, withdrawFee: 0.001 },
  { symbol: 'TRX', name: 'TRON', precision: 6, networks: ['TRC20'], minWithdraw: 20, withdrawFee: 1 },
];

// seedPrice is only used if live prices can't be fetched.
const pairs = [
  { base: 'BTC', pp: 2, qp: 5, seed: 90000 },
  { base: 'ETH', pp: 2, qp: 4, seed: 3000 },
  { base: 'BNB', pp: 2, qp: 3, seed: 900 },
  { base: 'SOL', pp: 2, qp: 3, seed: 140 },
  { base: 'XRP', pp: 4, qp: 1, seed: 2.2 },
  { base: 'DOGE', pp: 5, qp: 0, seed: 0.16 },
  { base: 'ADA', pp: 4, qp: 1, seed: 0.5 },
  { base: 'AVAX', pp: 2, qp: 2, seed: 15 },
  { base: 'LINK', pp: 2, qp: 2, seed: 14 },
  { base: 'DOT', pp: 3, qp: 2, seed: 3 },
  { base: 'LTC', pp: 2, qp: 3, seed: 90 },
  { base: 'TRX', pp: 4, qp: 1, seed: 0.28 },
];

async function main() {
  for (const a of assets) {
    const data = { ...a, minWithdraw: new D(a.minWithdraw), withdrawFee: new D(a.withdrawFee) };
    await prisma.asset.upsert({ where: { symbol: a.symbol }, create: data, update: data });
  }
  for (const [i, p] of pairs.entries()) {
    const symbol = `${p.base}USDT`;
    const data = { base: p.base, quote: 'USDT', pricePrecision: p.pp, qtyPrecision: p.qp, seedPrice: new D(p.seed), sortOrder: i };
    await prisma.pair.upsert({ where: { symbol }, create: { symbol, ...data }, update: data });
  }

  const pw = await bcrypt.hash('Admin@12345', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    create: { email: 'admin@example.com', name: 'Admin', passwordHash: pw, role: 'ADMIN', emailVerified: true, kycStatus: 'APPROVED' },
    update: { role: 'ADMIN' },
  });

  const demoPw = await bcrypt.hash('Demo@12345', 12);
  const demo = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    create: { email: 'demo@example.com', name: 'Demo Trader', passwordHash: demoPw, emailVerified: true, kycStatus: 'APPROVED' },
    update: {},
  });

  for (const [userId, asset, amount] of [
    [admin.id, 'USDT', 10000],
    [demo.id, 'USDT', 10000],
    [demo.id, 'BTC', 0.1],
    [demo.id, 'ETH', 1],
  ] as const) {
    const existing = await prisma.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    if (!existing) {
      await prisma.balance.create({ data: { userId, asset, available: new D(amount) } });
      await prisma.transaction.create({ data: { userId, type: 'BONUS', status: 'COMPLETED', asset, amount: new D(amount), note: 'Seed balance' } });
    }
  }

  console.log('Seeded assets, pairs and users:');
  console.log('  admin@example.com / Admin@12345 (admin)');
  console.log('  demo@example.com  / Demo@12345');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
