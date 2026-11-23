# Spawnpad verifier (data/code checks + Ed25519 attestations). Build context: repo root.
FROM node:22-slim
WORKDIR /app
COPY packages/shared packages/shared
COPY services/verifier/package.json services/verifier/package-lock.json services/verifier/
RUN cd services/verifier && npm ci --no-audit --no-fund
COPY services/verifier services/verifier
ENV VERIFIER_HOST=:: VERIFIER_PORT=4200 VERIFIER_KEYS_FILE=/keys/verifier.json NODE_ENV=production
WORKDIR /app/services/verifier
CMD ["npx", "tsx", "src/server.ts"]
