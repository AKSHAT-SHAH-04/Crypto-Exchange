# Zentra API (Fastify + matching engine + WebSockets). Build from the repo root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-slim

# Prisma's query engine needs OpenSSL
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only what the API workspace needs (lockfile lives at the monorepo root)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/api --include-workspace-root

COPY apps/api apps/api
RUN npm run build -w apps/api

ENV NODE_ENV=production
EXPOSE 4000
WORKDIR /app/apps/api

# Apply pending migrations, then start. Run exactly ONE instance: the matching engine is in-process.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
