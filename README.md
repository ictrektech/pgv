# PGV

面向 VOS 的共享 PostgreSQL 17、向量与搜索扩展、Redis 和 DBX 数据库管理界面。应用 ID 继续使用 `com.ictrek.pgv`，现有应用的数据库连接方式和数据目录保持兼容。

VOS 下只有两个同级子页面：**数据库连接器**与**接入指南**。连接器使用 VOS 管理员登录，自动连接 PGV PostgreSQL 和 Redis，跟随 VOS 切换中英文与主题；接入指南包含账号、密码来源、连接示例、预置数据库、建库 SQL、迁移和恢复说明。

| 服务 | 容器内地址 | 宿主机端口 | 持久化目录 |
|---|---|---|---|
| PostgreSQL | `pgv:5432` | `25432` | `${VOS_APP_STORAGE_PATH}/data` |
| Redis | `pgv-redis:6379` | 不导出 | `${VOS_APP_STORAGE_PATH}/redis` |
| DBX 管理界面 | `/app/com.ictrek.pgv/` | 调试端口 `25433` | `${VOS_APP_STORAGE_PATH}/viewer/dbx` |

Postgres 管理密码使用 VOS 注入的 `VOS_POSTGRES_PASSWORD`；Redis 使用 `VOS_REDIS_PASSWORD`。预置应用账号和数据库详见[完整用户说明](ictrek.app/src/README.zh-CN.md)。Redis 不占用其他应用的 `redis` 或 `hybrag-redis` 别名。

## 源码与发布

- `pgv/`：原 PostgreSQL 镜像源码、扩展和迁移工具。
- `crates/`、`apps/desktop/`：DBX 原生后端与 Vue 前端。
- `docker/vos/`：PGV 镜像、OIDC 网关和兼容适配。
- `ictrek.app/`：VOS 配置、两页导航、图标、完整说明与打包脚本。
- `.github/workflows/vos-release.yml`：GitHub Release 与应用商店发布 CI。

所有镜像在构建机 `~/dev/build/pgv` 下构建，构建前从本地同步源码；构建机不执行 Git。

```sh
./build_image.sh --sheet AMD_with_cuda --images pgv-viewer
./build_image.sh --sheet ARM_without_cuda --images pgv-viewer
# 镜像推送和飞书登记完成、代码提交推送后，在本机触发发布：
./ictrek.app/scripts/update_version.sh patch
```

新 viewer 使用独立的 `pgv-viewer` 镜像列；数据库与 Redis 镜像可复用。详细的权限边界、构建和回退流程见 [VOS.md](VOS.md)。升级保留旧 Tabularis 的整个 `viewer/` 目录；DBX 不自动转换旧的查询、标签页和自定义连接，PGV 的两个托管连接会自动创建。数据库数据不变。

## 上游 DBX

原上游说明保留在 [README-dbx.md](README-dbx.md) 与 [README-dbx.zh-CN.md](README-dbx.zh-CN.md)。DBX 使用 Apache-2.0；本仓库保留其 LICENSE 与 NOTICE。VOS 适配与打包以本 README 和 VOS.md 为准。

## 插件扩展

保留 DBX 插件中心、官方内置商店、签名与校验和检查、沙箱工作台、Go 原生侧车和 TypeScript 前端扩展。支持安装匹配当前架构的已签名插件，以及添加自有仓库和可信公钥；默认不允许通过 HTTP 安装未签名插件。插件数据随 `viewer/dbx` 持久化。开发与签名见 [插件开发指南](plugins/GETTING_STARTED.zh-CN.md) 和 [签名模型](plugins/SIGNING.md)。

## AI SQL 与 V-Scheduler

AI 助手自动提供 V-Scheduler 配置，下拉列出当前 VOS 账号可见的语言模型，可刷新后选择。无需再填写模型 API Key；生成、解释、优化和修复 SQL 仍通过 DBX 原生 AI 与 SQL 安全检查执行，调用经过 Scheduler 的鉴权、排队与额度控制。未安装 Scheduler 时，数据库和接入指南仍可使用，原有手动 AI 提供方配置也保留。

发送问题前先选择数据库连接。原生助手会使用工具调用，因此所选模型还需支持 tools；仅支持文本补全的小模型可能返回“不支持工具”错误。调度排队超时会显示上游 429，可等待资源释放或选择其他支持工具的模型，PGV 不绕过调度限制。
