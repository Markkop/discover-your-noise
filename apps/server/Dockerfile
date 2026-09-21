# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/

RUN npm ci --workspace @discover-your-noise/server --include-workspace-root

COPY packages/core packages/core
COPY apps/server apps/server

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV EVERY_NOISE_CACHE_DIR=/data/everynoise-cache

RUN apk add --no-cache curl \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 dyn \
  && mkdir -p /data/everynoise-cache \
  && chown -R dyn:nodejs /data

COPY --from=build --chown=dyn:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=dyn:nodejs /app/packages ./packages
COPY --from=build --chown=dyn:nodejs /app/apps/server ./apps/server
COPY --from=build --chown=dyn:nodejs /app/package.json ./package.json
COPY --from=build --chown=dyn:nodejs /app/package-lock.json ./package-lock.json

USER dyn

EXPOSE 3001

VOLUME ["/data/everynoise-cache"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "apps/server/src/index.mjs"]
