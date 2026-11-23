# Spawnpad API (Fastify + node:sqlite + Privacy Ring adapter). Build context: repo root.
FROM node:22-slim
WORKDIR /app
COPY packages/shared packages/shared
COPY packages/ring/package.json packages/ring/package-lock.json packages/ring/
RUN cd packages/ring && npm ci --no-audit --no-fund
COPY packages/ring packages/ring
COPY apps/api/package.json apps/api/package-lock.json apps/api/
RUN cd apps/api && npm ci --no-audit --no-fund
COPY apps/api apps/api
ENV API_HOST=:: DATA_DIR=/data NODE_ENV=production
WORKDIR /app/apps/api
CMD ["npx", "tsx", "src/server.ts"]
