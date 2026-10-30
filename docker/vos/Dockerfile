# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.18.0-trixie-slim
ARG RUST_IMAGE=rust:1-trixie
FROM ${RUST_IMAGE} AS backend
RUN sed -i 's|deb.debian.org|mirrors.huaweicloud.com|g' /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y --no-install-recommends cmake pkg-config perl make clang libssl-dev python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY src-tauri ./src-tauri
COPY plugins ./plugins
COPY vendor ./vendor
COPY docker/vos/offline-git /tmp/pgv-git-deps
# Git dependencies are archived locally and synced with the build context. Build hosts never run Git.
COPY docker/vos/prepare_offline.py /tmp/prepare_offline.py
RUN python3 /tmp/prepare_offline.py
RUN mkdir -p /usr/local/cargo && printf '[source.crates-io]\nreplace-with = "mirror"\n[source.mirror]\nregistry = "sparse+https://rsproxy.cn/index/"\n' > /usr/local/cargo/config.toml
ENV CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=120
RUN --mount=type=cache,id=pgv-dbx-registry,target=/usr/local/cargo/registry --mount=type=cache,id=pgv-dbx-target,target=/src/target \
    CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 cargo build --release -p dbx-web --no-default-features --config 'profile.release.package.dbx-web.opt-level=1' --config 'profile.release.package.dbx-web.codegen-units=64' && install -Dm755 target/release/dbx-web /out/dbx-web

FROM ${NODE_IMAGE} AS frontend
WORKDIR /src
RUN npm install -g pnpm@10.30.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN --mount=type=cache,id=pgv-dbx-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY apps/desktop ./apps/desktop
COPY scripts ./scripts
COPY plugins ./plugins
COPY crates/dbx-core/assets ./crates/dbx-core/assets
COPY ictrek.app/src ./ictrek.app/src
COPY pgv/README.md pgv/PG17-MIGRATION.md ./pgv/
COPY VOS.md ./
RUN VITE_DBX_BASE_PATH=/app/com.ictrek.pgv/ pnpm build

FROM debian:trixie-slim
RUN sed -i 's|deb.debian.org|mirrors.huaweicloud.com|g' /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini gosu libssl3t64 && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 --user-group --home-dir /data pgv
COPY --from=backend /out/dbx-web /usr/local/bin/dbx-web
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend /src/dist /app/static
COPY docker/vos/gateway.mjs docker/vos/scheduler.mjs docker/vos/entrypoint.sh /app/vos/
COPY LICENSE NOTICE /usr/share/doc/dbx/
ENV DBX_PORT=8082 DBX_BIND_ADDR=127.0.0.1 DBX_DISABLE_PASSWORD=1 DBX_DISABLE_PASSWORD_VIEWER=1 DBX_PUBLIC_BASE_PATH=/app/com.ictrek.pgv DBX_STATIC_DIR=/app/static DBX_DATA_DIR=/data/dbx DBX_BACKUP_ROOT=/data/dbx/backups HOME=/data
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=6 CMD ["curl", "-fsS", "http://127.0.0.1:8081/healthz"]
ENTRYPOINT ["tini", "--", "/bin/sh", "/app/vos/entrypoint.sh"]
