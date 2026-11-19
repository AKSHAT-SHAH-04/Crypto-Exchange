# Deploying Zentra

```
Browser ──► Vercel (Next.js web app) ──/api/* proxied──► Railway: API (Fastify + engine)
   └──────────── wss:// WebSocket (live prices) ─────────►        ├─ Postgres
                                                                   └─ Redis
```

The **web app** goes on Vercel (or Netlify). The **API cannot run on Vercel/Netlify**: it is a long-running
server with an in-memory matching engine, WebSockets and background jobs, so it runs on Railway.

This guide deploys **paper-trading mode** (demo funds, live prices) — safe to put online today.

- **Option A — Free ($0):** Vercel + Render (free API + Redis) + Supabase (free Postgres). Start here.
- **Option B — Paid (~$10–25/mo):** Vercel + Railway. Always on, no sleeping, more headroom.

---

# Option A — Free deployment

| Piece | Service (free tier) | Limits to know |
|---|---|---|
| Website | Vercel Hobby | Non-commercial use only |
| API + Redis | Render free web service + free Key Value | 512 MB RAM; **sleeps after 15 min without traffic** (step A5 keeps it awake); 750 h/month ≈ 24/7 for one service |
| Database | Supabase free Postgres | 500 MB; paused only after 7 days without activity (the API keeps it active) |

### A1. Database — Supabase (~3 min)
1. supabase.com → sign in with GitHub → **New project** → region **Southeast Asia (Singapore)** → set a strong
   database password (save it).
2. Project → **Connect** → copy the **Session pooler** connection string (host `…pooler.supabase.com`, port `5432`)
   and replace `[YOUR-PASSWORD]`. Use the session pooler, not "direct": Render can't reach Supabase's IPv6-only
   direct host.

### A2. API + Redis — Render (~5 min + first build)
1. render.com → sign in with GitHub → **New → Blueprint** → select the `Crypto-Exchange` repo.
   It reads `render.yaml` and creates `zentra-api` (Docker, Singapore) and `zentra-redis`.
2. When asked, fill in:
   - `DATABASE_URL` → the Supabase session-pooler string from A1
   - `WEB_URL` → `https://zentra.vercel.app` for now (fixed in A4)

   `JWT_SECRET` and `ENCRYPTION_KEY` are generated for you. **Never change `ENCRYPTION_KEY` afterwards.**
3. **Apply.** The first Docker build takes a few minutes. Migrations run automatically on start.
4. Open `https://<your-service>.onrender.com/api/health` → `{"ok":true,...}`.

### A3. Seed markets + your admin (from your laptop, once)
Render's free tier has no shell, so seed from your machine against the Supabase database:
```bash
cd /path/to/Crypto-Exchange
DATABASE_URL='<supabase session pooler url>' NODE_ENV=production \
SEED_ADMIN_EMAIL='you@yourdomain.com' SEED_ADMIN_PASSWORD='a-long-unique-password' \
npm run db:seed:prod -w apps/api
```
Then on Render → `zentra-api` → **Manual Deploy → Restart service** so it loads the markets.
Log in later and **turn on 2FA for the admin right away**.

### A4. Website — Vercel (~3 min)
1. vercel.com → sign in with GitHub → **Add New → Project** → import the repo → **Root Directory: `apps/web`**.
2. Environment variables:
   - `API_INTERNAL_URL` = `https://<your-service>.onrender.com`
   - `NEXT_PUBLIC_WS_URL` = `wss://<your-service>.onrender.com/ws`
   - `NEXT_PUBLIC_BRAND_NAME` = `Zentra`
3. **Deploy**, then copy the site URL into Render's `WEB_URL` (Render redeploys automatically).

### A5. Keep the API awake (free)
cron-job.org (free) → new cron job → URL `https://<your-service>.onrender.com/api/health` → every **10 minutes**.
Without this, the first visitor after 15 idle minutes waits ~1 minute while the API wakes up.

### A6. Check
- Open `https://<vercel-site>/api/meta` — `yourIp` should be **your** public IP. If it shows a data-center IP,
  change `TRUST_PROXY_HOPS` on Render (try `3`), otherwise rate limits would be shared by all users.
- Markets show live prices; register (10,000 demo USDT); place a trade; admin panel loads.

On a free instance the API restarts now and then: open orders, balances and history are kept (they live in
Postgres), and the market-maker quotes refill within seconds.

---

# Option B — Paid: Railway

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
