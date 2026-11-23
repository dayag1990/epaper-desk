# Postgres with WAL-G for continuous WAL archiving (M13). Pinned versions.
FROM postgres:17.2-bookworm
ARG WALG_VER=v3.0.5
ADD --chmod=755 https://github.com/wal-g/wal-g/releases/download/${WALG_VER}/wal-g-pg-ubuntu-22.04-amd64 /usr/local/bin/wal-g
RUN wal-g --version
