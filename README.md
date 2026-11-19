# Crypto Exchange

A full-stack spot crypto exchange: live markets, pro trading screen, an in-house matching engine, wallets, 2FA, KYC, user API keys and an admin console.

**Phase 1 (this release) is paper trading.** Every new user gets 10,000 demo USDT. Prices, candles and market trades mirror the live market via public Binance market data (no API key needed). Orders are matched by our own engine.

> The brand name is configurable via `NEXT_PUBLIC_BRAND_NAME` in `.env`.

## Features

| Area | What's included |
|---|---|
| Auth | Email/password signup, email verification, login, JWT session (httpOnly cookie), Google login, TOTP 2FA, password reset, sign out of all devices |
| Markets | 12 USDT pairs with live price, 24h change/high/low/volume, search, sort, gainers/losers, favourites |
| Trading | Candlestick chart (1m–1w) with live updates, live order book with depth bars (click a level to fill the price), market trades, Limit / Market / Stop-limit orders, open orders, order history, trade history, cancel / cancel all |
| Matching engine | Price-time priority per pair, self-trade prevention, maker/taker fees, partial fills, price improvement refunds, stop triggers. A market-maker bot quotes 12 levels each side around the reference price and fills resting user orders when the market moves through them |
| Wallet | Balances (available / in orders), USD valuation, portfolio pie chart, deposit addresses, instant demo deposits, withdrawal address whitelist, email-confirmed withdrawals, transaction history |
| Account | Profile, KYC submission & status, 2FA setup, password change, HMAC-signed API keys (read / trade), activity log |
| Admin | Stats dashboard, user search / freeze (cancels open orders) / balance adjustments, KYC approvals, withdrawal approvals, pair listing, enable/disable, fee config, audit log |
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

## Phase 2 roadmap (real money)

Phase 2 needs the corresponding provider keys:

1. **Custody & on-chain:** real deposit addresses and deposit detection (Alchemy/Infura for EVM, Tatum/BlockCypher for BTC), or a custodian (Fireblocks/BitGo). Replace `fakeAddress()` and the admin "approve" step with a real broadcaster.
2. **Fiat on-ramp:** INR deposits and withdrawals via a payment provider, with webhooks crediting `Transaction` rows.
3. **KYC provider:** document upload and liveness (Sumsub/Onfido/HyperVerge) in place of the manual form.
4. **SMS OTP:** Twilio/MSG91.
5. **Ops:** Sentry, backups, and a dedicated matching-engine process with a write-ahead log.
6. **Compliance:** operating a real exchange requires regulatory registration (in India, FIU-IND under the PMLA) plus AML/transaction monitoring. Get legal advice before enabling `live` mode.
