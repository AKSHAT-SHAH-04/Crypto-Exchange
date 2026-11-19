<p align="center"><img src="apps/web/public/brand/zentra-logo.svg" alt="Zentra" width="220"></p>

# Zentra

A full-stack spot crypto exchange: live markets, pro trading screen, an in-house matching engine, wallets, 2FA, KYC, user API keys and an admin console.

**Phase 1 (this release) is paper trading.** Every new user gets 10,000 demo USDT. Prices, candles and market trades mirror the live market via public Binance market data (no API key needed). Orders are matched by our own engine.

> The brand name is configurable via `NEXT_PUBLIC_BRAND_NAME` in `.env`.

## Features

| Area | What's included |
|---|---|
| Auth | Email/password signup, email verification, login, JWT session (httpOnly cookie), Google login, TOTP 2FA, password reset, sign out of all devices |
| Markets | 12 USDT pairs with live price, 24h change/high/low/volume, search, sort, gainers/losers, favourites |
| Trading | Candlestick chart (1m–1w) with live updates, depth chart, live order book with depth bars, price grouping and bids/asks views (click a level to fill the price), market trades, Limit / Market / Stop-limit / **OCO** / **Trailing-stop** orders, open orders, order history, trade history, cancel / cancel all, price alerts |
| Matching engine | Price-time priority per pair, self-trade prevention, maker/taker fees, partial fills, price improvement refunds, stop and trailing triggers, OCO legs sharing one fund lock. A market-maker bot quotes 12 levels each side around the reference price and fills resting user orders when the market moves through them |
| Growth | **Referral program** (20% of referees' trading fees, `REFERRAL_COMMISSION_RATE`), **Auto-Invest** recurring buys (hourly → monthly, from USDT or AED/INR), **Simple Earn** flexible & locked products (treasury-funded interest, admin-managed APRs) |
| More trading | 29 markets including BTC-quoted pairs (ETH/BTC, SOL/BTC, BNB/BTC, XRP/BTC), **post-only** and **IOC / FOK** time-in-force, chart indicators (MA 7/25/99, EMA 20, Bollinger Bands) and line/candle styles |
| Mobile | Installable app (PWA): web manifest, home-screen icons, offline page; service worker never caches API data |
| Fees | VIP tiers by 30-day volume (VIP 0–5, admin override), and an optional fee-discount token (`FEE_DISCOUNT_ASSET`, 25% off) |
| Convert | Instant swap between any two assets with a 10-second guaranteed quote and zero fees (a spread is built into the rate) |
| P2P | Buy and sell crypto for INR via UPI, IMPS, bank or Paytm. Merchant ads, escrow (crypto is locked until released), payment window with auto-cancel, in-order chat, mark-paid → release flow, disputes resolved by admins, completion-rate stats |
| Wallet | Balances (available / in orders), USD valuation, portfolio pie chart, deposit addresses, instant demo deposits, withdrawal address whitelist, email-confirmed withdrawals, transaction history, CSV export |
| Account | Profile, KYC submission & status, 2FA setup, password change, HMAC-signed API keys (read / trade), Fees & VIP, price alerts, activity log |
| Sub-accounts | Up to 20 per user, instant internal transfers, switch into a sub-account to trade, freeze. Sub-accounts can't withdraw |
| Platform | Notification center (bell + page, real-time), announcements, support tickets with staff replies, CSV statements (trades, orders, transactions, converts), English / हिन्दी / Español |
| Admin | Stats dashboard, user search / freeze (cancels open orders) / balance adjustments / VIP override, KYC approvals, withdrawal approvals, P2P dispute resolution, support inbox, announcements, pair listing, enable/disable, fee config, audit log |
| Security | bcrypt (12 rounds), Redis-backed rate limiting, CSRF double-submit token, zod validation on every endpoint, helmet headers, AES-256-GCM encrypted API secrets, audit logs, withdrawal whitelist + email confirmation + KYC gate + 2FA |

## Architecture

```
apps/
  api/   Fastify + TypeScript, Prisma (PostgreSQL), Redis, WebSocket gateway
  web/   Next.js 14 (App Router) + Tailwind, lightweight-charts, recharts
```

- **Postgres** is the source of truth for users, balances, orders, trades and transactions.
- **Matching engine** (`apps/api/src/engine`) keeps an in-memory order book per pair, rebuilt from open orders on startup. Each pair has a serial job queue; every order is matched as a dry run, then fund locking, order creation and settlement happen in one DB transaction, and only then is the in-memory book updated.
- **Redis** handles pub/sub for real-time events (so several API instances can share one WebSocket fan-out), rate-limit counters, and caches for tickers, depth and candles.
- **WebSocket** `ws://localhost:4000/ws` carries the channels `tickers`, `depth:<SYMBOL>`, `trades:<SYMBOL>`, and a private `user` channel authenticated with a short-lived token.
- The web app proxies `/api/*` to the API (see `next.config.mjs`), so cookies are first-party.

## Quick start

Requirements: Node 20+, and either Docker or local PostgreSQL 14+ and Redis 6+.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    set JWT_SECRET and ENCRYPTION_KEY:  openssl rand -hex 32
#    if not using Docker, point DATABASE_URL / REDIS_URL at your local services

# 3. Start Postgres + Redis (skip if running locally)
docker compose up -d

# 4. Create the schema and seed data
npm run db:migrate
npm run db:seed

# 5. Run API (:4000) and web (:3000)
npm run dev
```

Open http://localhost:3000.

**Seeded accounts**

| Email | Password | Role |
|---|---|---|
| admin@example.com | Admin@12345 | Admin (KYC approved) |
| demo@example.com | Demo@12345 | User with 10k USDT, 0.1 BTC, 1 ETH |
| merchant@example.com | Demo@12345 | P2P merchant with live buy and sell USDT ads |

Without `RESEND_API_KEY`, emails (verification, password reset, withdrawal confirmation) are printed to the API console, so you can click the links locally.

### Production build

```bash
npm run build
npm run db:deploy -w apps/api
npm run start -w apps/api   # API
npm run start -w apps/web   # Web
```

Put both behind one domain (e.g. `exchange.com` → web, with `/api` and `/ws` routed to the API) and set `NODE_ENV=production`, `WEB_URL`, `NEXT_PUBLIC_WS_URL=wss://…/ws`.

## Environment variables

See `.env.example`. Summary:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | yes | Data stores |
| `JWT_SECRET`, `ENCRYPTION_KEY` | yes | Session signing, API-secret encryption (32-byte hex) |
| `WEB_URL` | yes | Used in email links and the Google OAuth callback |
| `TRADING_MODE` | – | `paper` (default) |
| `SIGNUP_BONUS_USDT` | – | Demo funds for new users |
| `EXTERNAL_FEED_ENABLED` | – | `false` = fully offline, simulated prices |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Real email delivery via Resend |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google login. Authorized redirect URI: `${WEB_URL}/api/auth/google/callback` |
| `NEXT_PUBLIC_BRAND_NAME` | – | Brand shown across the UI and emails |
| `API_INTERNAL_URL`, `NEXT_PUBLIC_WS_URL` | – | Where the web app reaches the API |

## REST API

All endpoints are under `/api`. Browser sessions use the `cx_session` cookie plus an `x-csrf-token` header that matches the `cx_csrf` cookie. Programmatic clients use API keys:

```
X-API-KEY:        <key>
X-API-TIMESTAMP:  <unix ms>
X-API-SIGNATURE:  hex(HMAC_SHA256(secret, timestamp + METHOD + path_with_query + json_body))
```

API keys can read data and (if enabled) trade. They cannot change account security settings or withdraw.

| Method | Path | Description |
|---|---|---|
| GET | `/markets` | Pairs with live tickers |
| GET | `/markets/:symbol/depth?limit=` | Order book |
| GET | `/markets/:symbol/trades` | Recent market trades |
| GET | `/markets/:symbol/klines?interval=1h` | Candles |
| POST | `/orders` | `{symbol, side, type: LIMIT\|MARKET\|STOP_LIMIT, quantity, price?, stopPrice?}` |
| DELETE | `/orders/:id`, `/orders?symbol=` | Cancel one / all |
| GET | `/orders/open`, `/orders/history`, `/trades/my` | User orders & fills |
| GET | `/wallet/balances`, `/wallet/transactions` | Wallet |
| POST | `/wallet/withdraw` | Whitelisted address only, needs verified email + KYC (+2FA if enabled) |

Auth, account and admin routes are in `apps/api/src/routes`.

## Real money: how money moves

| Flow | Rail | Fee to user | How it settles |
|---|---|---|---|
| Deposit AED / INR | Bank transfer to the company client-money account, quoting the user's reference (`CX…`) | **Free** | Bank partner webhook `POST /api/webhooks/bank` (HMAC-signed) or admin reconciliation. Transfers from a name that doesn't match KYC are held for review |
| Withdraw AED / INR | Bank payout to the user's own account (holder must match KYC) | `FIAT_WITHDRAW_FEE` (default 0) | Email confirmation → admin approval → bank payout (webhook or "mark paid") |
| Deposit crypto | Per-user address at the custodian (Fireblocks omnibus vault) | Free | Credited only when the custodian's signed webhook reports `COMPLETED` |
| Withdraw crypto | Custodian transaction to a whitelisted address | Per-asset network fee | Admin approval → custodian → webhook completes or refunds |
| Buy with card / Apple Pay | Onramper aggregator (cheapest licensed provider per order) or Transak | Partner's fee (≈1% bank, 3–5% card) | Partner sends crypto on-chain to the user's own deposit address; credited via the custodian |
| Sell to card / bank | Partner off-ramp | Partner's fee | User confirms the on-chain transfer to the partner with 2FA |
| Convert (incl. AED/INR ↔ crypto) | Internal, against the treasury | 0.1% spread, no fee | Treasury inventory must cover payouts in live mode |
| P2P (AED / INR) | User-to-user; Aani, UAE bank, UPI, IMPS | Free | Escrowed on-platform |

**Ledger invariant:** the sum of user balances plus the treasury account (`treasury@system.internal`) equals the assets held at the custodian and banks. Trading fees, withdrawal fees and the Convert spread accrue to the treasury.

**Jurisdictions:** onboarding is limited to `ALLOWED_COUNTRIES` (default UAE + India). US users are blocked by KYC country and by the edge IP-country header (`GEO_IP_HEADER`). Blocked users can still log in, cancel orders and withdraw their own funds.

## Going live checklist

`TRADING_MODE=live` refuses to start unless the basics are in place: a real custodian, the market maker off, a live price feed, email configured, HTTPS and strong secrets. Beyond that:

1. **Licences:** VARA licence (Dubai) and FIU-IND registration (India). Get legal sign-off on terms, AML/CFT program and Travel Rule handling.
2. **Partners:** UAE and India banking partners (client-money accounts plus webhooks), Fireblocks workspace (omnibus vault, webhook public key, `FIREBLOCKS_ASSET_MAP` verified in sandbox), and an Onramper or Transak production account. Verify widget parameters and webhook signatures in their sandboxes.
3. **KYC:** replace the manual form with a KYC/AML provider (document + liveness + sanctions screening).
4. **Infra:** run exactly **one** API instance (the matching engine is in-process), behind a CDN/WAF that sets the country header (`TRUST_PROXY_HOPS` must match your proxies). Managed Postgres with PITR backups, managed Redis, Sentry.
5. **Seed:** `NODE_ENV=production SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run db:seed`. No demo users are created. Enable 2FA on every admin.
6. **Treasury:** pre-fund the treasury account for Convert inventory, and reconcile it daily against custodian and bank balances.
7. **Dependencies:** upgrade Next.js (critical advisory) and Fastify 5 before launch (see the production-readiness notes).
