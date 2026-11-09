# PGV API 与协议参考

本页按 PGV 的 VOS 网关说明接入。其他应用连接数据库使用 PostgreSQL / Redis 协议；DBX HTTP 属于管理员工作台内部接口，会随 DBX 版本变化。数据库客户端不能连接查看器 HTTP 端口。VOS 登录身份、V-Scheduler Key 均不能替代数据库密码。

[协议地址](#pgv-api-protocols) · [VOS 鉴权](#pgv-api-auth) · [返回类型](#pgv-api-responses) · [错误与流式](#pgv-api-errors) · [只读示例](#pgv-api-example) · [原生操作参考](#pgv-api-native)

<h2 id="pgv-api-protocols">1. 协议地址</h2>

- PostgreSQL：容器网络 `pgv:5432`；宿主默认 `<HOST>:25432`，由 ICTREK_PGV_PORT 调整。使用应用独立数据库、角色和数据库密码；VOS token 不是 PostgreSQL 密码。SQL 结果、事务和 SQLSTATE 遵循 PostgreSQL 协议，不是 JSON 信封。
- Redis：`pgv-redis:6379`，不映射宿主端口；AUTH 使用当前注入的 VOS_REDIS_PASSWORD。DB 编号与前缀仅隔离命名，不是权限隔离。客户端使用 RESP 而非 HTTP；不要误接其他应用私有的队列/Redis。
- 查看器：VOS 路径 `/app/com.ictrek.pgv`，容器8081/宿主默认25433；DBX 8082 仅容器回环可达。网关不提供外部数据库管理 Key 或原生密码登录。建库、角色、扩展与目录见「接入与建库」。

<h2 id="pgv-api-auth">2. VOS 网关会话</h2>

以下路径相对 `/app/com.ictrek.pgv`，使用 VOS 的 HTTPS origin 并信任其证书。必须是经过 VOS 校验、账号名为 **admin** 的用户；数据库 owner 或持有模型 Key 不等于该权限。会话请求仍会重新检查 VOS 身份。

| 操作 | 请求 | 返回 |
| --- | --- | --- |
| POST /api/vos/login | 同源 Origin；JSON `access_token:string`，由 VOS OAuth 流程取得 | 200 `{assets:string}` 并设置 HttpOnly 的 pgv_vos_session cookie，本地会话最长12小时；assets 是插件只读资源票据，不是 API Key。 |
| GET /api/auth/check | 网关会话 cookie | 200 `{authenticated:true,required:true,setup_required:false}`；没有会话返回401。 |
| POST /api/auth/logout | 同源 Origin 与会话 cookie | 204 无正文，撤销会话、插件票据及推理访问。 |
| 其他 /api/auth/* | 原生 setup/login/password 操作 | VOS 中返回403，不能照搬 DBX_PASSWORD / dbx_session 原生说明。 |

任意 DBX 请求附加 Bearer 不能替代网关 cookie；VOS token 放在 login 的 JSON 中。HTTP API 和 WebSocket 均需会话，非 GET/HEAD 请求须同源 Origin。客户端伪造身份头无效。不要在文档或共享日志中输出 cookie、票据或 token。

<h2 id="pgv-api-responses">3. 常用管理操作与返回类型</h2>

JSON 按各 DTO 命名：connectionId、removedIds 等请求外层为 camelCase，ConnectionConfig 仍用 snake_case，不能整体自动改名。成功响应没有通用 `{code,data}` 信封。

| 操作 | 请求 | HTTP200 成功正文 |
| --- | --- | --- |
| GET /api/connection/list | 无正文 | ConnectionResponse[]，含 id,name,db_type,host,port,username,database,save_password 等与可选 jdbc_dialect；已存凭据引用/脱敏值不是可复用的明文密码。 |
| POST /api/connection/save | `{configs:ConnectionConfig[],removedIds?:string[]}` | JSON null，不是204。按 id 合并保存，仅 removedIds 显式删除。 |
| POST /api/connection/test | `{config:ConnectionConfig,clientAttempt?:integer}` | JSON 字符串测试消息，不回传密码。 |
| POST /api/connection/test-info | 同 test | `{message:string,database_info?:object}`。 |
| POST /api/connection/connect | 同 test | JSON 字符串连接标识；先连接再查询。 |
| POST /api/query/execute | connectionId,database,sql 必填字符串；可选 schema,catalog,executionId,clientSessionId,timeoutSecs,maxRows,fetchSize,pageSize,rowOffset,maxResultBytes；其他高级字段按原生 DTO | QueryResult：columns:string[],rows:JSON[][],column_types:string[],column_sortables:boolean[],affected_rows:integer,execution_time_ms:integer，以及可选时间/类型/空间/延迟读取元数据。行与 columns 对齐，类型元数据可能为空或较短。 |
| POST /api/query/cancel | `{executionId:string,cancel?:boolean}` 与可选 typeRecovery | `{requested:boolean,terminal:boolean,databaseTerminal?:boolean}`，须检查实际结束/停止状态；关闭浏览器不代表回滚或执行退出。 |
| GET /api/ai/configs | 会话 cookie | AI 配置数组与受管 V-Scheduler 项，不返回可复用的厂商 Key。 |
| POST /api/ai/models | `{config:AIConfig}` | V-Scheduler 返回 `[{id:string,displayName:string}]`，按当前 VOS 账号可见范围筛选；其他 Provider 保留原生返回约定。 |

<h2 id="pgv-api-errors">4. 错误、流式、文件与重试</h2>

网关错误可能为纯文本：401 会话缺失/过期，403 管理员或 Origin 校验失败，405 方法错误，502 后端不可达，503 V-Scheduler 发现/运行时不可用。先检查 HTTP 状态和 Content-Type，再解析 JSON。原生结构化 BackendError 包括 version,code,messageKey,messageParams,source,origin,operationOutcome，可选 detail,diagnostics,helpUrl,errorPosition,transactionOutcome；不要解析自然语言判断错误。框架 JSON 校验拒绝可能使用不同正文。

导入/导出/传输/SQL文件/AI 任务可能使用 SSE、multipart、独立取消和下载接口。保留 SSE 事件名、data 和终态，连接成功不等于任务完成。二进制下载按 Content-Type/Content-Disposition 读取；上传实际文件，不传服务器不可见的客户端本地路径。各写操作不具备统一幂等键；超时后先核对执行与事务状态，不能直接重放，也不能把断网当成事务回滚。会话过期走 VOS 登录桥，不要重设数据库密码。

PGV VOS 在原生密码关闭、仅回环的边界内禁用了受管 MCP 暴露，原生 DBX_PASSWORD / MCP Web 登录示例不适用。外部应用使用数据库协议凭据，或明确支持的业务接口。

<h2 id="pgv-api-example">5. 只读 HTTP 示例</h2>

通常浏览器会自动建立会话；管理员集成可使用同样的序列。VOS_TOKEN 是当前 VOS OAuth token，不是模型厂商 Key。

```sh
export PGV_ORIGIN='https://<VOS-HOST>:1180'
export PGV_URL="$PGV_ORIGIN/app/com.ictrek.pgv"
umask 077
SESSION_DIR=$(mktemp -d)
trap 'rm -rf "$SESSION_DIR"' EXIT
printf '{"access_token":"%s"}' "$VOS_TOKEN" > "$SESSION_DIR/login.json"
curl --fail-with-body -c "$SESSION_DIR/cookies" -H "Origin: $PGV_ORIGIN" \
  -H 'Content-Type: application/json' --data-binary @"$SESSION_DIR/login.json" \
  "$PGV_URL/api/vos/login" -o "$SESSION_DIR/session.json"
curl --fail-with-body -b "$SESSION_DIR/cookies" "$PGV_URL/api/auth/check"
curl --fail-with-body -b "$SESSION_DIR/cookies" "$PGV_URL/api/connection/list"
curl --fail-with-body -b "$SESSION_DIR/cookies" -H "Origin: $PGV_ORIGIN" \
  -X POST "$PGV_URL/api/auth/logout"
```

<h2 id="pgv-api-native">6. 原生操作参考</h2>

以下离线文档说明 DBX 请求体，请叠加上述 VOS 路径与会话约束。原生独立部署登录、CLI 密码登录与原生 MCP Web 设置不适用于此部署。局部 data-grid OpenAPI 不代表所有 DBX 接口。

## 请求约定

- 字段命名由具体 Rust 请求结构决定，既有 `camelCase`，也有连接配置使用的 `snake_case`；不要对整个 API 套用单一命名规则。
- `GET` 查询参数通常使用 `snake_case`，例如 `connection_id`，但仍应以当前路由实现为准。
- 原生错误使用上述 BackendError，网关拒绝可能是纯文本。
- 导出、导入、数据传输、SQL 文件和 AI 等长任务通常使用“启动请求 + SSE 进度 + 取消/下载”组合，不是一个同步响应。

只有数据网格提取器当前提供受测试的局部 OpenAPI 文档：`/api/query/data-grid-extractor-openapi.json`。它不覆盖完整 DBX Web API，也不代表其它路由已经版本化。

## 连接相关 API

### 列出连接

```http
GET /api/connection/list
Cookie: pgv_vos_session=...
```

返回已保存的连接配置。密码等敏感信息不会直接出现在返回 JSON 中。

### 保存连接

连接按 `id` 增量写入：请求中未出现的连接保持不变，因此多个客户端共用同一个服务端时不会互相删除
对方的连接；删除连接通过可选的 `removedIds` 显式声明。

```http
POST /api/connection/save
Content-Type: application/json
Cookie: pgv_vos_session=...

{
  "configs": [
    {
      "name": "local-mysql",
      "db_type": "mysql",
      "host": "127.0.0.1",
      "port": 3306,
      "username": "root",
      "database": "app"
    }
  ],
  "removedIds": ["connection-to-delete"]
}
```

### 测试连接

```http
POST /api/connection/test
Content-Type: application/json

{
  "config": {
    "name": "temp",
    "db_type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "username": "root",
    "database": "app"
  }
}
```

### 建立连接

大多数数据类 API 会要求目标连接先处于已连接状态。

```http
POST /api/connection/connect
Content-Type: application/json

{
  "config": {
    "id": "connection-id",
    "name": "local-mysql",
    "db_type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "username": "root",
    "database": "app"
  }
}
```

### 健康检查

```http
POST /api/connection/check-health
Content-Type: application/json

{
  "connectionId": "connection-id"
}
```

## Schema API

### 列出表

```http
GET /api/schema/tables?connection_id=CONNECTION_ID&database=app&schema=
Cookie: pgv_vos_session=...
```

### 列出字段

```http
GET /api/schema/columns?connection_id=CONNECTION_ID&database=app&schema=&table=users
Cookie: pgv_vos_session=...
```

### 读取 Oracle 系触发器

不需要先知道所属表，可按触发器类型发现对象。精确适配器先筛选，再分页：

```http
GET /api/schema/objects?connection_id=CONNECTION_ID&database=demo&schema=APP&object_types=TRIGGER&filter=audit&limit=100&offset=0&identity_mode=exact
```

所属对象入口使用真实 parent owner/name；返回的触发器 owner 可以不同：

```http
GET /api/schema/triggers?connection_id=CONNECTION_ID&database=demo&schema=DATA&table=ORDERS&identity_mode=exact
```

完整定义使用触发器自身的 owner/name。此路由的 `table` 参数是源码对象名，不是父表：

```http
GET /api/schema/object-source?connection_id=CONNECTION_ID&database=demo&schema=APP&table=AUDIT_ORDERS&object_type=TRIGGER&identity_mode=exact
```

三项接口均接受可选 `identity_mode=exact` 和 `catalog`。省略模式时保持旧读取合同；精确模式保留原始 owner/name，空格、引号等字符应 URL 编码，不应 trim 或转换大小写。`catalog` 透传给实际 provider，不替代 `schema`。

对象和源码响应可包含 `trigger.oracle_metadata`，所属对象列表各项直接包含 `oracle_metadata`。版本 1 提供已核实的 engine、原始身份、作用域、独立 parent、字符串 object ID 及逐字段 `reads` 状态。`enabled` 是启用状态，`valid` 是独立读取的对象有效性；Schema/Database 作用域不填假父表。

exact 源码查询成功且零行时，返回 `reads.identity.state="empty"`，保留已核实的引擎和原始目标。这只表示当前可见范围内无匹配对象，不推断全库不存在；查询失败和旧 provider 缺契约不能产生该证明。新建仍使用不带 REPLACE 的 CREATE。

源码元数据另含来源、格式、完整性及带行列的编译错误。缺失或 null 错误列表表示未知，不是成功读到零错误。不完整或失败的读取不能作为替换基线；保留草稿，补齐字典访问或更新 provider 后重读。旧 Agent/插件仍可按旧模式使用，但缺少新元数据时不能证明 exact 身份。`DBMS_METADATA` 可能附带同目标的状态语句；导出原文和单定义保存内容分别处理。

其他常用 Schema 路由包括：

- `/api/schema/databases`
- `/api/schema/schemas`
- `/api/schema/indexes`
- `/api/schema/foreign-keys`
- `/api/schema/ddl`

## SQL 查询 API

### 执行单条语句

```http
POST /api/query/execute
Content-Type: application/json

{
  "connectionId": "connection-id",
  "database": "app",
  "sql": "select id, name from users limit 10"
}
```

响应示例：

```json
{
  "columns": ["id", "name"],
  "rows": [[1, "Ada"], [2, "Lin"]]
}
```

相关路由：

| 路由 | 作用 |
| --- | --- |
| `/api/query/execute-multi` | 一次请求执行多个结果集 |
| `/api/query/execute-batch` | 执行语句列表 |
| `/api/query/cancel` | 取消正在执行的查询 |
| `/api/query/build-table-select-sql` | 生成表浏览 SQL |

### 准备 Oracle 系触发器的单个定义

`POST /api/query/prepare-oracle-trigger-sql` 的请求体为 `{ "input": ... }`。input 包含 `databaseType`（`oracle`、`oceanbase-oracle` 或 `dameng`）、原始 `owner`/`name`、`source` 和 `purpose`（`inspect`、`create` 或 `replace`）。返回单个规范化 `definition`、解析后的 `header`，以及独立的内联/导出启用状态。`comparisonSource` 仅用于读回比较：规范化已确认的声明包装，保留头部其余内容、正文、注释及字符串换行；执行时使用 `definition`。该接口只准备 SQL；核对当前对象、权限和并发变化后，沿正常查询接口执行。

创建和替换还需传入已核实的 `binding`：`scope` 为 `TABLE`、`VIEW`、`SCHEMA`、`DATABASE` 或 `TIMER`；适用时带真实 parent `owner`/`name`，Oracle 容器作用域另带已核实的 `pluggable`。省略的 ON 限定只从该绑定补全。替换还需传入期望保全的 `enabled`。新建生成不带 OR REPLACE 的 CREATE；Oracle/已验证 OB 将状态保全在定义内，DM 返回的 `requiresStateRestore` 表示需要另行预览和核实原生状态步骤。`allowExportAppendix` 仅用于查看可信元数据导出；写入用途拒绝该选项及额外 SQL。

`structuredEditable` 表示完整定义的头部能否由时机、事件和正文表单无损表达。值为 false 或缺失时，结构修改须使用完整源码入口；只有 `TRIGGER_BODY` 不能证明可以安全重建定义。

## Redis API

Redis 浏览和命令执行使用独立路由。

```http
POST /api/redis/execute-command
Content-Type: application/json

{
  "connectionId": "redis-id",
  "db": 0,
  "command": "GET mykey"
}
```

其他常见 Redis 路由：

- `/api/redis/scan-keys`
- `/api/redis/get-value`
- `/api/redis/set-string`
- `/api/redis/delete-key`

## MongoDB API

MongoDB 路由都是 `POST` 请求，使用 JSON 请求体。

### 列出集合

```http
POST /api/mongo/list-collections
Content-Type: application/json

{
  "connectionId": "mongo-id",
  "database": "app"
}
```

### 查询文档

```http
POST /api/mongo/find-documents
Content-Type: application/json

{
  "connectionId": "mongo-id",
  "database": "app",
  "collection": "users",
  "skip": 0,
  "limit": 20,
  "filter": "{}"
}
```

其他 MongoDB 路由还包括 `aggregate-documents`、`insert-documents`、`update-documents`、`delete-documents` 等。


## 写入、安全和文件边界

- API 认证只证明请求来自已登录会话，不会替代数据库权限
- 查询、导入和传输路径会继续检查连接只读保护；生产保护和 SQL 风险策略在对应核心路径中执行
- 浏览器上传的表导入和 SQL 文件会写入服务器临时目录，不是浏览器电脑的原始路径
- Web 导出先生成服务器临时文件，再通过下载路由返回并清理
- 反向代理应保留 Cookie、SSE 流和较长请求超时，并限制公网暴露范围

## 示例脚本

仓库内示例：

- [examples/web-api/automation.sh](https://github.com/t8y2/dbx/tree/main/examples/web-api/automation.sh)
- [examples/docker/docker-compose.yml](https://github.com/t8y2/dbx/tree/main/examples/docker/docker-compose.yml)
- [examples/cli/basic-workflow.sh](https://github.com/t8y2/dbx/tree/main/examples/cli/basic-workflow.sh)

## 其他路由分组

Web 后端还为界面提供了更多路由，例如：

- `/api/export/*`：导出与下载
- `/api/import/*`：表导入
- `/api/transfer/*`：数据传输任务
- `/api/ai/*`：内置 AI 助手
- `/api/agents/*`、`/api/jdbc/*`：驱动管理
- `/api/history/*`、`/api/saved-sql/*`：编辑器状态

完整路由列表见仓库中的 `crates/dbx-web/src/main.rs`。
