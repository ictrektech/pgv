# PGV on VOS

This repository owns `com.ictrek.pgv`: PostgreSQL 17 and extensions, dedicated shared Redis, the DBX viewer, the integration guide, and the complete VOS package/release workflow.

## Existing service contract

PostgreSQL remains at `pgv:5432`, aliases `ictrek-pgv` / `shared-pgv`, host port 25432. Data stays under `${VOS_APP_STORAGE_PATH}/data`; configuration stays under `config`. Application databases, roles, passwords, extensions and PG16-to-PG17 migration are preserved in `pgv/` and `ictrek.app/src/init/`.

Redis remains at `pgv-redis:6379`, alias `ictrek-pgv-redis`, no host port, required `VOS_REDIS_PASSWORD`, AOF every second, `noeviction`, persistent `redis/`. It never claims `redis` or `hybrag-redis`. Existing applications retain their connection configuration.

## Viewer and navigation

The same-origin iframe endpoint is `/app/com.ictrek.pgv/`; the static guide is `/app/com.ictrek.pgv/integration-guide`. `routers.yml` declares exactly two sibling pages (connector and guide), with no extra group nesting.

DBX's native backend binds only to `127.0.0.1:8082` inside the container. Only the gateway on port 8081 is exported (host debug port 25433). The gateway validates a VOS OIDC access token against `/v1000/oauth2/userinfo` and restricts shared database administration to the verified `admin` account. Every HTTP API and WebSocket request requires the gateway session, and mutations require a same-origin Origin header. Client-supplied user headers are never authentication. DBX native password auth is disabled only behind this loopback boundary; no native API port is published. Managed MCP exposure is disabled by the native password-disabled mode.

Startup idempotently provisions and connects `PGV PostgreSQL` and `PGV Redis` using VOS environment credentials. No live password is included in the guide. DBX encrypts stored credentials with its managed data-directory key. Back up the complete `${VOS_APP_STORAGE_PATH}/viewer/dbx` directory, including `.dbx/secret.key` and `dbx.db`.

VOS initial and live locale/theme changes are applied before rendering the connector. The guide is a separate static bootstrap: it never initializes database stores, calls database APIs, or replaces connector cookies. Both pages retain the PGV logo. Production marking remains enabled and uses pale blue. DBX upstream promotion and community widgets are not part of the PGV navigation.

## Upgrade and rollback

This is a viewer-only migration: the published PGV database and Redis images are reused. Existing Tabularis metadata under `viewer/` is preserved. New DBX metadata lives under `viewer/dbx/`; saved Tabularis queries, tabs and personal connections are not automatically converted. The two managed PGV connections are recreated automatically from the existing environment. No PostgreSQL or Redis data migration is introduced.

Before an upgrade, save the installed PGV package/version and configuration and take a normal database backup. Roll back by reinstalling the previous PGV package using the unchanged storage path; its Tabularis metadata remains intact. Do not delete `data`, `redis`, `config`, or the old `viewer` contents.

## Build and release

Run Git locally only. Sync the complete source to `~/dev/repos/pgv` on architecture-matched build hosts before each build. `build_image.sh` stages the build under `~/dev/build/pgv`. Pinned Git-only Rust dependencies are archived locally under `docker/vos/offline-git`; build hosts never clone or fetch Git repositories.

```sh
./build_image.sh --sheet AMD_with_cuda --images pgv-viewer
./build_image.sh --sheet ARM_without_cuda --images pgv-viewer
# Optional unchanged PostgreSQL image rebuild:
./build_image.sh --sheet AMD_with_cuda --images pgv
```

The `pgv-viewer` component has its own Feishu column and Huawei registry repository. PostgreSQL continues to resolve the existing `pgv` column; Redis reuses the existing published architecture images. Publish and verify every affected image before packaging.

After committing/pushing verified code, run `./ictrek.app/scripts/update_version.sh patch` locally. The only fork workflow is `.github/workflows/vos-release.yml`; it packages both architectures using Feishu, publishes the GitHub Release, and uploads to VOS App Store. Required Actions Secrets are `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `APPSTORE_IP`, `APPSTORE_TOKEN`. The canonical Feishu document ID is fixed configuration, not a secret.

If only store upload fails after the release asset exists, use:

```sh
gh workflow run vos-release.yml --repo ictrektech/pgv --ref main -f version=0.0.54
```

The retry verifies the original asset digest and republishes that package without changing tags or rebuilding images.

## Plugin Marketplace and custom plugins

The DBX Plugin Center remains available inside PGV. Official Marketplace catalog fallback, Ed25519 repository signatures, SHA-256 package checksums, trusted-key management, permission declarations, sandboxed workbenches, native sidecar lifecycle, plugin events, asset serving and plugin persistence use the upstream implementation. Plugin APIs pass through the same verified VOS administrator boundary. The proxy preserves multipart uploads and streaming responses.

Use Plugin Center to install signed packages (including compatible S3, Kubernetes and LDAP extensions), or add a private repository and its independently verified public key. Custom plugins can use the bundled Go SDK and TypeScript/Vite frontend templates. Build and package the plugin on a development/build machine with `dbx-plugin`; upload the signed `.dbxp` through Plugin Center. Frontend-only packages are universal; native sidecars must include `linux-x86_64` / `linux-aarch64` targets matching the installed PGV profile. Follow the exact target names accepted by the SDK packager. No compiler is required inside the running PGV container.

Unsigned HTTP installation stays disabled by default; no signature checks or iframe sandbox flags are removed. The UI workbench is sandboxed; native sidecars run as the container's unprivileged user and are not an operating-system sandbox. They have only the viewer storage mount and no Docker socket or NAS filesystem mount. Go/TypeScript SDK, signing and publishing references remain under `plugins/sdk/`, `plugins/GETTING_STARTED.zh-CN.md` and `plugins/SIGNING.md`.

## AI SQL via V-Scheduler

V-Scheduler is optional for the entire PGV app and is not an installation or Compose dependency. Manual AI provider configuration never waits for Scheduler discovery. When available, the AI assistant includes a managed `V-Scheduler` configuration and discovers the current VOS account's visible language models from `http://v-scheduler:8080/api/v1/models`. Embedding, image, speech and reranker-only models are excluded. Qualified model IDs and chat/responses/messages capabilities determine routing; the model picker fetches a fresh catalog on every open and every 15 seconds while open and visible. Successful discovery replaces the managed list, including removals, while manual provider models and their normal cache remain unchanged. Installing Scheduler after PGV needs no restart or reinstall.

Requests run through the DBX native AI/agent implementation, including SQL tool approvals, but its runtime provider configuration targets a loopback-only inference bridge. The bridge forwards the verified current VOS user's token to V-Scheduler `/v1/*`. The VOS token and model-provider API keys are never persisted in DBX or sent to the browser. The runtime uses a short-lived gateway session reference only; logout or expiry revokes inference. Existing manual DBX providers remain available. Scheduler admission, queueing, visibility and limits remain authoritative; PGV does not invoke model upstreams directly or allocate permits itself. The database connector and guide remain available when Scheduler is absent.

Plugin Web resources use per-session, read-only asset tickets under `/app/com.ictrek.pgv/plugin-assets/`. This allows module chunks, CSS and fonts to load from opaque-origin workbench sandboxes without giving them database API access or exposing the HttpOnly VOS session. Tickets are separate from login and inference session keys, limited to one plugin's resource paths by the sandbox CSP, and revoked on logout. `allow-scripts` is retained without `allow-same-origin`.
