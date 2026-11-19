import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const D = Prisma.Decimal;

const isProd = process.env.NODE_ENV === 'production';

const fiat = [
  { symbol: 'AED', name: 'UAE Dirham', precision: 2, networks: ['BANK'], minWithdraw: 50, withdrawFee: 0, isFiat: true },
  { symbol: 'INR', name: 'Indian Rupee', precision: 2, networks: ['BANK'], minWithdraw: 1000, withdrawFee: 0, isFiat: true },
  { symbol: 'USD', name: 'US Dollar', precision: 2, networks: ['BANK'], minWithdraw: 20, withdrawFee: 0, isFiat: true },
];

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
  for (const a of [...assets, ...fiat]) {
    const data = { ...a, minWithdraw: new D(a.minWithdraw), withdrawFee: new D(a.withdrawFee) };
    await prisma.asset.upsert({ where: { symbol: a.symbol }, create: data, update: data });
  }
  for (const [i, p] of pairs.entries()) {
    const symbol = `${p.base}USDT`;
    const data = { base: p.base, quote: 'USDT', pricePrecision: p.pp, qtyPrecision: p.qp, seedPrice: new D(p.seed), sortOrder: i };
    await prisma.pair.upsert({ where: { symbol }, create: { symbol, ...data }, update: data });
  }

  if (isProd) {
    // Production: no demo users or well-known passwords. Create the first admin from env, once.
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (email && password) {
      if (password.length < 14) throw new Error('SEED_ADMIN_PASSWORD must be at least 14 characters');
      await prisma.user.upsert({
        where: { email: email.toLowerCase() },
        create: { email: email.toLowerCase(), name: 'Admin', passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN', emailVerified: true },
        update: {},
      });
      console.log(`Admin ${email} ensured. Log in and enable 2FA immediately.`);
    }
    console.log('Seeded assets and pairs (production: demo data skipped).');
    return;
  }

  const pw = await bcrypt.hash('Admin@12345', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    create: { email: 'admin@example.com', name: 'Admin', passwordHash: pw, role: 'ADMIN', emailVerified: true, kycStatus: 'APPROVED', country: 'AE' },
    update: { role: 'ADMIN' },
  });

  const demoPw = await bcrypt.hash('Demo@12345', 12);
  const demo = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    create: { email: 'demo@example.com', name: 'Demo Trader', passwordHash: demoPw, emailVerified: true, kycStatus: 'APPROVED', country: 'AE' },
    update: { country: 'AE' },
  });

  // demo users get an approved KYC record so fiat/P2P flows work out of the box
  for (const [u, name, country] of [[admin, 'Admin User', 'AE'], [demo, 'Demo Trader', 'AE']] as const) {
    if (!(await prisma.kycSubmission.count({ where: { userId: u.id } }))) {
      await prisma.kycSubmission.create({ data: { userId: u.id, fullName: name, dateOfBirth: '1990-01-01', country, idType: 'EMIRATES_ID', idNumber: '784199012345678', status: 'APPROVED', reviewedAt: new Date() } });
    }
  }

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

  // ---- P2P demo merchant with live ads so the marketplace isn't empty ----
  const merchant = await prisma.user.upsert({
    where: { email: 'merchant@example.com' },
    create: { email: 'merchant@example.com', name: 'QuickPay Merchant', passwordHash: demoPw, emailVerified: true, kycStatus: 'APPROVED', country: 'IN' },
    update: { country: 'IN' },
  });
  if (!(await prisma.p2PAd.count({ where: { userId: merchant.id } }))) {
    await prisma.balance.upsert({
      where: { userId_asset: { userId: merchant.id, asset: 'USDT' } },
      create: { userId: merchant.id, asset: 'USDT', available: new D(45000), locked: new D(5000) },
      update: { available: new D(45000), locked: new D(5000) },
    });
    await prisma.p2PPaymentMethod.createMany({
      data: [
        { userId: merchant.id, type: 'UPI', label: 'Primary UPI', details: { upiId: 'quickpay@okbank', name: 'QuickPay Merchant' } },
        { userId: merchant.id, type: 'IMPS', label: 'HDFC current', details: { accountNumber: '50100012345678', ifsc: 'HDFC0001234', name: 'QuickPay Merchant', bank: 'HDFC Bank' } },
      ],
    });
    await prisma.p2PAd.createMany({
      data: [
        { userId: merchant.id, side: 'SELL', asset: 'USDT', price: new D(88.5), totalAmount: new D(5000), remaining: new D(5000), minFiat: new D(500), maxFiat: new D(200000), paymentTypes: ['UPI', 'IMPS'], terms: 'Pay only from an account in your own name. No third-party payments.' },
        { userId: merchant.id, side: 'BUY', asset: 'USDT', price: new D(86.9), totalAmount: new D(10000), remaining: new D(10000), minFiat: new D(1000), maxFiat: new D(300000), paymentTypes: ['UPI', 'IMPS', 'BANK'], terms: 'I release INR within 10 minutes of order creation.' },
      ],
    });
  }

  if (!(await prisma.announcement.count())) {
    await prisma.announcement.createMany({
      data: [
        { title: 'Welcome to paper trading', category: 'General', pinned: true, body: 'Every new account gets 10,000 demo USDT. Prices, candles and market trades mirror the live market so you can practise risk-free.\n\nTry the new OCO and trailing-stop orders, Convert and P2P!' },
        { title: 'New: OCO, trailing stop and price alerts', category: 'Product', body: 'Protect profits with One-Cancels-the-Other orders, let a trailing stop follow the market, and get notified when a price level is reached.' },
        { title: 'P2P trading is live for INR', category: 'Product', body: 'Buy and sell USDT directly with other users via UPI, IMPS and bank transfer. Crypto is held in escrow until the seller confirms payment.' },
        { title: 'Scheduled maintenance', category: 'Maintenance', body: 'Deposits and withdrawals may be briefly delayed during routine maintenance this Sunday 02:00-02:30 UTC. Trading is not affected.' },
      ],
    });
  }

  console.log('Seeded assets, pairs and users:');
  console.log('  admin@example.com / Admin@12345 (admin)');
  console.log('  demo@example.com  / Demo@12345');
  console.log('  merchant@example.com / Demo@12345 (P2P merchant)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
