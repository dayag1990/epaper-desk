# syntax=docker/dockerfile:1
# Multi-stage build for api and worker. Pinned base image.
FROM node:22.12.0-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec prisma generate --schema prisma/schema.prisma \
 && pnpm --filter @epaper/api --filter @epaper/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=1001:1001 /app /app
USER 1001:1001

FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 8100
# migrate (expand-only) then serve
CMD ["sh", "-c", "cd /app && node apps/api/dist/migrate.js && cd apps/api && exec node dist/server.js"]

FROM runtime AS worker
WORKDIR /app/apps/worker
EXPOSE 3001
CMD ["node", "dist/main.js"]
