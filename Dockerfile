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
 && pnpm --filter @epaper/api... --filter @epaper/worker... build
# The Tamil and Gurmukhi web fonts must be in the image: the api serves them at /fonts, the worker renders PDFs with the same files.
RUN test -s "templates/fonts/noto-serif-tamil/NotoSerifTamil[wdth,wght].ttf" && test -s "templates/fonts/anek-tamil/AnekTamil[wdth,wght].ttf" \
 && test -s "templates/fonts/noto-sans-gurmukhi/NotoSansGurmukhi[wdth,wght].ttf" && test -s "templates/fonts/anek-gurmukhi/AnekGurmukhi[wdth,wght].ttf"

FROM base AS runtime
ENV NODE_ENV=production FONTS_DIR=/app/templates/fonts
COPY --from=build --chown=1001:1001 /app /app
USER 1001:1001

FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 8100
# migrate (expand-only) then serve
CMD ["sh", "-c", "cd /app && node apps/api/dist/migrate.js && cd apps/api && exec node dist/server.js"]

# The worker runs Chromium (Playwright 1.49.1, matches the pinned package) and Poppler, so it sits on the Playwright image.
# Same Node version as the build stage. fonts-noto-core carries Gurmukhi for Punjabi pages.
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS worker
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils fonts-noto-core fonts-noto-ui-core \
 && rm -rf /var/lib/apt/lists/* && fc-cache -f
ENV NODE_ENV=production HOME=/tmp PLAYWRIGHT_BROWSERS_PATH=/ms-playwright FONTS_DIR=/app/templates/fonts
COPY --from=build --chown=1001:1001 /app /app
USER 1001:1001
WORKDIR /app/apps/worker
EXPOSE 3001
CMD ["node", "dist/main.js"]
