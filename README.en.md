# PGV

Shared PostgreSQL 17, vector/search extensions, dedicated Redis and an embedded DBX viewer for VOS. The app remains `com.ictrek.pgv`; existing service endpoints, database roles, credentials and storage paths remain compatible.

The VOS app contains exactly two sibling pages: **Database Connector** and **Integration Guide**. VOS administrator authentication, automatic PG/Redis connections, live locale/theme synchronization, PGV branding and pale-blue production marking are included. The guide is static and cannot replace the connector session.

PostgreSQL remains `pgv:5432` (host 25432), Redis remains `pgv-redis:6379` without a host port, and the viewer remains `/app/com.ictrek.pgv/` (debug port 25433). The gateway validates VOS identities; DBX's native backend is restricted to container loopback. Credentials come from `VOS_POSTGRES_PASSWORD` and `VOS_REDIS_PASSWORD`.

See the [complete user manual](ictrek.app/src/README.en.md) for pre-created databases, application accounts, SQL and integration examples. See [VOS.md](VOS.md) for build, release, authorization and rollback details.

```sh
./build_image.sh --sheet AMD_with_cuda --images pgv-viewer
./build_image.sh --sheet ARM_without_cuda --images pgv-viewer
# After publishing images/Feishu and committing/pushing code, run locally:
./ictrek.app/scripts/update_version.sh patch
```

Sync local source to architecture-matched build machines before building; all generated artifacts go under `~/dev/build/pgv`. Build machines never run Git. The new `pgv-viewer` image/Feishu component is separate from the unchanged `pgv` database image. `.github/workflows/vos-release.yml` owns package and App Store publication.

DBX metadata is stored under `${VOS_APP_STORAGE_PATH}/viewer/dbx`. Existing Tabularis metadata is retained for rollback; custom connections, saved queries and tabs are not automatically converted. Database and Redis contents remain unchanged.

Upstream documentation is preserved in [README-dbx.md](README-dbx.md) and [README-dbx.zh-CN.md](README-dbx.zh-CN.md). The Apache-2.0 LICENSE and NOTICE remain included.

## Plugin extensions

The upstream Plugin Center, signed Marketplace, checksum verification, sandboxed workbenches, Go sidecars and TypeScript frontend extensions remain enabled. Install signed packages for the current architecture or add a private repository and trusted public key. Unsigned HTTP installs remain disabled. Plugin state persists with `viewer/dbx`. See [plugin development](plugins/sdk/cli/README.md) and [signing](plugins/SIGNING.md).

## AI SQL and V-Scheduler

The AI assistant exposes a managed V-Scheduler configuration and a refreshable dropdown of language models visible to the current VOS account. No duplicate API key is required. DBX retains native AI/SQL tool approvals; Scheduler owns inference routing, admission and limits. Database access works without Scheduler, and manual AI providers remain available.
