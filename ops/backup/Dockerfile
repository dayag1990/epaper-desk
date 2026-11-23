# Backup service: restic 0.17.3 + the PostgreSQL 17 client tools + bash + jq.
# Based on the same pinned Postgres image the database runs, so pg_basebackup always matches the server.
FROM restic/restic:0.17.3 AS restic
FROM postgres:17.2-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY ops/backup/lib.sh ops/backup/bk /opt/backup/
COPY scripts/lib/backup-env.sh /usr/local/bin/backup-env.sh
RUN chmod 755 /opt/backup/bk /usr/local/bin/backup-env.sh && ln -s /opt/backup/bk /usr/local/bin/bk
ENV RESTIC_CACHE_DIR=/cache HOME=/tmp
USER 1001:1001
ENTRYPOINT ["/opt/backup/bk"]
CMD ["daemon"]
