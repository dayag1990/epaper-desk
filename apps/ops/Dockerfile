# syntax=docker/dockerfile:1
# Standalone: built from apps/ops only. No api, worker or Prisma.
FROM node:22.12.0-slim AS run
WORKDIR /app
COPY src ./src
USER 1001:1001
EXPOSE 8101
CMD ["node", "src/server.mjs"]
