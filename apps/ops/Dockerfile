# syntax=docker/dockerfile:1
# The ops desk image. Built from the repo root (see docker-compose.ops.yml):
#   docker build -f apps/ops/Dockerfile .
# Only apps/ops and packages/core are copied in: no api, worker, Prisma or Chromium.
FROM node:22.12.0-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/ops apps/ops
RUN pnpm install --frozen-lockfile --filter "@epaper/ops..." \
 && pnpm --filter @epaper/core build \
 && pnpm --filter @epaper/ops build

# docker CLI + compose plugin only (no daemon). It talks to the socket PROXY via DOCKER_HOST, never to a raw socket.
FROM docker:27.3.1-cli AS dockercli

FROM node:22.12.0-slim AS run
ENV NODE_ENV=production
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
COPY --from=build --chown=1001:1001 /app /app
WORKDIR /app/apps/ops
USER 1001:1001
EXPOSE 8101
CMD ["node", "dist/server.js"]
