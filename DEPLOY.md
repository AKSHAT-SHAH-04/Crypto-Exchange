# Deploying Zentra

```
Browser ──► Vercel (Next.js web app) ──/api/* proxied──► Railway: API (Fastify + engine)
   └──────────── wss:// WebSocket (live prices) ─────────►        ├─ Postgres
                                                                   └─ Redis
```

The **web app** goes on Vercel (or Netlify). The **API cannot run on Vercel/Netlify**: it is a long-running
server with an in-memory matching engine, WebSockets and background jobs, so it runs on Railway.

This guide deploys **paper-trading mode** (demo funds, live prices) — safe to put online today.

---

## 1. API + database + Redis on Railway (~10 min)

1. Sign in at railway.com with GitHub → **New Project → Deploy from GitHub repo** → pick `Crypto-Exchange`.
   Railway reads `railway.json` and builds `apps/api/Dockerfile`.
2. In the project: **+ New → Database → PostgreSQL**, then **+ New → Database → Redis**.
3. **Region — important:** open the API service → **Settings → Region** and choose **Singapore (asia-southeast)**
   or **Amsterdam (europe-west)**. *Binance's public market data is blocked from US regions*; in a US region
   prices would fall back to simulation. Singapore is also closest to India and the UAE. Put Postgres/Redis in
   the same region.
4. API service → **Variables** → add:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `TRADING_MODE` | `paper` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference) |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   | `JWT_SECRET` | output of `openssl rand -hex 32` |
   | `ENCRYPTION_KEY` | output of `openssl rand -hex 32` (a **different** value; never change it later) |
   | `WEB_URL` | `https://zentra.vercel.app` for now — update after step 2 |
   | `TRUST_PROXY_HOPS` | `2` (Vercel edge + Railway proxy — keeps per-user rate limits correct) |
   | `GEO_IP_HEADER` | `x-vercel-ip-country` |
   | `NEXT_PUBLIC_BRAND_NAME` | `Zentra` |
   | `RESEND_API_KEY` | optional; without it emails (verification, resets) are only written to the logs |

5. **Settings → Networking → Generate Domain**. Note it, e.g. `zentra-api.up.railway.app`.
6. Wait for the deploy to go green (migrations run automatically on start). Check
   `https://<api-domain>/api/health` → `{"ok":true,...}`.
7. **Seed markets, coins and Earn products, and create your admin** — API service → **⋯ → Run command / Shell**:
   ```
   SEED_ADMIN_EMAIL=you@yourdomain.com SEED_ADMIN_PASSWORD='a-long-unique-password' npm run db:seed:prod
   ```
   (Production seeding never creates the demo accounts.) Then redeploy the API once so it loads the new markets.
   Log in and **enable 2FA on the admin account immediately**.

Keep the API at **1 replica** (already set in `railway.json`).

## 2. Web app on Vercel (~5 min)

1. vercel.com → **Add New → Project** → import `Crypto-Exchange`.
2. **Root Directory:** `apps/web` (Framework: Next.js is detected; leave build/install defaults).
3. **Environment Variables:**

   | Variable | Value |
   |---|---|
   | `API_INTERNAL_URL` | `https://<api-domain>` (where `/api/*` is proxied) |
   | `NEXT_PUBLIC_WS_URL` | `wss://<api-domain>/ws` |
   | `NEXT_PUBLIC_BRAND_NAME` | `Zentra` |

4. **Deploy.** Note the URL (e.g. `zentra-xyz.vercel.app`, or add your own domain under Settings → Domains).
5. Back on Railway, set `WEB_URL` to that exact `https://…` URL and let the API redeploy
   (used for CORS, email links and the Google login callback).
6. Geo-blocking check: blocking by KYC country always works. For IP-based blocking, confirm the
   `x-vercel-ip-country` header reaches the API (or put Cloudflare in front and use `cf-ipcountry`).

`API_INTERNAL_URL` and `NEXT_PUBLIC_*` are baked in at build time — after changing them, **redeploy** on Vercel.

### Netlify instead of Vercel
Import the repo on Netlify; `netlify.toml` sets base `apps/web`. Use the same three environment variables.
Netlify doesn't pass a plain ISO country header to proxied APIs, so for IP-based geo-blocking put Cloudflare
in front (`GEO_IP_HEADER=cf-ipcountry`). Blocking by KYC country works either way.

## 3. Smoke test

- Open the site → markets show live prices; the order book moves.
- Register → you get 10,000 demo USDT → place a market buy on BTC/USDT.
- Log in as the admin → **Admin** tab loads.
- Optional Google login: create an OAuth client with redirect URI `https://<web-domain>/api/auth/google/callback`,
  then set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on the API.

## Costs (rough)

Vercel Hobby: free (Pro needed for commercial use). Railway: usage-based — API + Postgres + Redis typically
lands around US$10–25/month at low traffic.

## Before real money
Paper mode only. Going live needs the checklist in README → *Going live checklist* (licences, custodian,
banking partners, KYC vendor, dependency upgrades, tests, monitoring). `TRADING_MODE=live` refuses to start
until the critical pieces are configured.
