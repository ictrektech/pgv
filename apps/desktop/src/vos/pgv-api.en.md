# PGV API and protocol reference

This page documents the PGV VOS gateway. PostgreSQL and Redis are the application integration protocols; DBX HTTP is the administrator workbench's internal API and can change with DBX releases. Do not point a PostgreSQL/Redis client at the viewer HTTP port. VOS login and V-Scheduler access keys do not replace database passwords.

[Protocols](#pgv-api-protocols) · [VOS authentication](#pgv-api-auth) · [Responses](#pgv-api-responses) · [Errors and streaming](#pgv-api-errors) · [Read-only example](#pgv-api-example) · [Native operation reference](#pgv-api-native)

<h2 id="pgv-api-protocols">1. Protocol endpoints</h2>

- PostgreSQL: `pgv:5432` in vos_default; external `<HOST>:25432` by default, configurable with ICTREK_PGV_PORT. Use a dedicated database/role and the application's database password. A VOS Bearer token is not a PostgreSQL password. SQL results, transactions and SQLSTATE follow PostgreSQL wire protocol; they are not JSON envelopes.
- Redis: `pgv-redis:6379`, no published host port. AUTH uses the current injected VOS_REDIS_PASSWORD; DB index and prefixes separate names, not permissions. Native clients use RESP, not HTTP. Do not connect to another application's private queue/Redis.
- Viewer gateway: `/app/com.ictrek.pgv` through VOS, container8081/host25433 by default. DBX's port8082 remains container-loopback only. The gateway does not expose a public database-management API key or native password login. See Connect & create databases for roles, extensions and storage.

<h2 id="pgv-api-auth">2. VOS gateway session</h2>

All paths below are relative to `/app/com.ictrek.pgv`. Use the VOS HTTPS origin and trust its certificate. An authenticated **VOS account named admin** is required; being a database owner or possessing a V-Scheduler key is insufficient. Requests are checked against VOS again during the session.

| Operation | Request | Response |
| --- | --- | --- |
| POST /api/vos/login | Same-origin Origin; JSON `access_token:string`, obtained by the VOS OAuth flow | 200 `{assets:string}` and HttpOnly cookie `pgv_vos_session` (12-hour local session limit). assets is a plugin read-only asset ticket, not an API key. |
| GET /api/auth/check | Gateway session cookie | 200 `{authenticated:true,required:true,setup_required:false}`. Without a session:401. |
| POST /api/auth/logout | Same-origin Origin and session cookie | 204 with no body; revokes session, plugin asset tickets and inference access. |
| Other /api/auth/* | Native setup/login/password operations | 403 in VOS; do not use DBX_PASSWORD or dbx_session native instructions. |

The gateway accepts the Bearer token only inside the login JSON, not as a replacement for the cookie on arbitrary DBX requests. Every HTTP API and WebSocket needs the gateway session; non-GET/HEAD requests require a matching Origin. No client-supplied identity header grants access. Keep cookies/tickets/tokens out of shared logs and documents.

<h2 id="pgv-api-responses">3. Common administrator operations and response types</h2>

Request fields follow individual serde DTOs: envelope fields such as connectionId and removedIds use camelCase; ConnectionConfig fields use snake_case. Do not rename all JSON fields automatically. There is no universal `{code,data}` success envelope.

| Operation | Request | HTTP200 success body |
| --- | --- | --- |
| GET /api/connection/list | No body | `ConnectionResponse[]`; includes profile fields id,name,db_type,host,port,username,database,save_password and optional jdbc_dialect. Stored credential references/redaction are not reusable plaintext passwords. |
| POST /api/connection/save | `{configs:ConnectionConfig[],removedIds?:string[]}` | JSON `null` (not 204). Upserts by id; only listed removedIds are deleted. |
| POST /api/connection/test | `{config:ConnectionConfig,clientAttempt?:integer}` | JSON string containing the test message. Does not return the supplied password. |
| POST /api/connection/test-info | Same as test | `{message:string,database_info?:object}`. |
| POST /api/connection/connect | Same as test | JSON string identifying the connected profile. Connect before querying. |
| POST /api/query/execute | Required connectionId,database,sql strings; optional schema,catalog,executionId,clientSessionId,timeoutSecs,maxRows,fetchSize,pageSize,rowOffset,maxResultBytes; other advanced options follow native DTO | QueryResult with columns:string[], rows:JSON[][], column_types:string[], column_sortables:boolean[], affected_rows:integer, execution_time_ms:integer, optional timing/type/spatial/deferred-value metadata. Result rows align with columns; type metadata can be shorter/empty. |
| POST /api/query/cancel | `{executionId:string,cancel?:boolean}` plus optional typeRecovery binding | `{requested:boolean,terminal:boolean,databaseTerminal?:boolean}`; inspect actual completion/stop state. Closing a browser is not transaction rollback or proof of server exit. |
| GET /api/ai/configs | Session cookie | AI configuration array plus managed V-Scheduler entry. Credentials are not returned as reusable vendor keys. |
| POST /api/ai/models | `{config:AIConfig}` | Managed V-Scheduler selection returns `[{id:string,displayName:string}]`, filtered by current VOS user permissions. Other providers retain native response behavior. |

<h2 id="pgv-api-errors">4. Errors, streaming, files and safe retries</h2>

Gateway failures can be plain text:401 missing/expired session,403 invalid VOS administrator or Origin,405 wrong method,502 backend unavailable,503 V-Scheduler discovery/runtime unavailable. Check status and Content-Type before JSON parsing. The native backend's structured error has version, code, messageKey, messageParams, source, origin and operationOutcome, with optional detail, diagnostics, helpUrl, errorPosition and transactionOutcome. Do not classify errors by prose text. Framework JSON validation errors can use a different rejection body.

Exports/imports/transfers/SQL-file/AI jobs may use SSE, multipart uploads and separate cancellation/download routes. Preserve SSE event names, data and terminal events; a successful stream connection is not a completed job. Download by Content-Type/Content-Disposition rather than treating binary data as JSON. Upload a browser file, not a nonexistent client-local path on the server. A generic idempotency key is not supported for every write: after timeouts, check execution/transaction state before replaying mutations. Never infer rollback from a failed HTTP connection. Session expiry requires a fresh VOS login bridge, not resetting the database password.

The native MCP Web backend and DBX_PASSWORD examples below do not apply to PGV VOS: managed MCP exposure is disabled behind the VOS password-disabled loopback boundary. For an external application use PostgreSQL/Redis credentials, or an explicitly supported application-specific API.

<h2 id="pgv-api-example">5. Read-only HTTP example</h2>

The browser normally creates the session automatically. An authorized administrator's integration can perform the same sequence. VOS_TOKEN is a current VOS OAuth token, not a model-provider key.

```sh
export PGV_ORIGIN='https://<VOS-HOST>:1180'
export PGV_URL="$PGV_ORIGIN/app/com.ictrek.pgv"
# Store session artifacts privately; do not print them.
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

<h2 id="pgv-api-native">6. Native operation reference</h2>

The following bundled reference describes DBX operation payloads. Apply the VOS prefix/session rules above; native standalone authentication, CLI password login and native MCP Web setup are not enabled by this deployment. The scoped data-grid OpenAPI is not a contract for every DBX operation.

## Request Format

- Field naming follows each Rust request type. Some bodies use `camelCase`, while connection configuration still contains `snake_case`; do not apply one naming convention to the whole API.
- `GET` query parameters commonly use `snake_case`, such as `connection_id`, but the current route implementation remains authoritative.
- Native errors use BackendError; gateway rejections can be plain text, as documented above.
- Long-running export, import, transfer, SQL-file, and AI operations commonly use a start request plus SSE progress and cancel/download routes rather than one synchronous response.

Only the data-grid extractor currently exposes a tested, scoped OpenAPI document at `/api/query/data-grid-extractor-openapi.json`. It does not cover the complete DBX Web API or version the other routes.

## Connection APIs

### List Connections

```http
GET /api/connection/list
Cookie: pgv_vos_session=...
```

Returns saved connection profiles. Secrets such as passwords are stored separately from the returned JSON.

### Save Connections

Connections are upserted by `id`: connections the request does not mention are left untouched, so several
clients can share one server without deleting each other's profiles. Deletions are explicit through the
optional `removedIds` array.

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

### Test Connection

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

### Connect

Most data APIs expect the target connection to be active first.

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

### Check Health

```http
POST /api/connection/check-health
Content-Type: application/json

{
  "connectionId": "connection-id"
}
```

## Schema APIs

### List Tables

```http
GET /api/schema/tables?connection_id=CONNECTION_ID&database=app&schema=
Cookie: pgv_vos_session=...
```

### List Columns

```http
GET /api/schema/columns?connection_id=CONNECTION_ID&database=app&schema=&table=users
Cookie: pgv_vos_session=...
```

### Read Oracle-Family Triggers

To find triggers without knowing their owning table, use the object list with a
trigger type filter. Search and type filters are applied before paging in the
exact metadata adapters.

```http
GET /api/schema/objects?connection_id=CONNECTION_ID&database=demo&schema=APP&object_types=TRIGGER&filter=audit&limit=100&offset=0&identity_mode=exact
Cookie: pgv_vos_session=...
```

Use the owning object's schema and name to list its triggers. The returned
trigger owner can differ from that schema.

```http
GET /api/schema/triggers?connection_id=CONNECTION_ID&database=demo&schema=DATA&table=ORDERS&identity_mode=exact
Cookie: pgv_vos_session=...
```

Fetch the full definition using the **trigger's** owner and name. On this route,
`table` is the source object name, not its parent table.

```http
GET /api/schema/object-source?connection_id=CONNECTION_ID&database=demo&schema=APP&table=AUDIT_ORDERS&object_type=TRIGGER&identity_mode=exact
Cookie: pgv_vos_session=...
```

These three routes accept optional `identity_mode=exact` and `catalog` query
parameters. Omitting `identity_mode` retains the existing metadata behavior.
Exact reads preserve raw owner/name values; URL-encode spaces, quotes, and other
reserved characters rather than trimming or changing their case. `catalog` is
forwarded to the selected metadata provider; it does not replace `schema`.

Trigger summaries and source responses may contain `trigger.oracle_metadata`
(`oracle_metadata` directly on entries returned by `/schema/triggers`). Version
1 includes the verified engine, exact owner/name, scope, independent parent,
string-valued object ID, and per-field `reads` states. `enabled` is the trigger
state; `valid` is the independently read object validity. Schema/database scopes
do not have an invented table parent.

An exact source lookup that succeeds with no visible matching trigger returns
`reads.identity.state="empty"` with the verified engine and raw target. It means
empty within current visibility, not global absence. Query failures and legacy
providers cannot supply that proof; creation still uses CREATE without REPLACE.

Source metadata additionally reports definition origin/format/completeness and
compilation errors with line/position. A null or absent error list is unknown,
not an empty successful read. Failed or incomplete reads cannot supply a write
baseline; keep the draft, restore dictionary access or update the provider, and
read again. Old Agents/plugins that omit the metadata contract remain usable in
their original mode but do not prove exact identity. The source text can include
a same-target state appendix from `DBMS_METADATA`; it is export text, not an
arbitrary multi-statement save payload.

Other schema routes include:

- `/api/schema/databases`
- `/api/schema/schemas`
- `/api/schema/indexes`
- `/api/schema/foreign-keys`
- `/api/schema/ddl`

## SQL Query APIs

### Execute One Statement

```http
POST /api/query/execute
Content-Type: application/json

{
  "connectionId": "connection-id",
  "database": "app",
  "sql": "select id, name from users limit 10"
}
```

Example response shape:

```json
{
  "columns": ["id", "name"],
  "rows": [[1, "Ada"], [2, "Lin"]]
}
```

Related routes:

| Route | Purpose |
| --- | --- |
| `/api/query/execute-multi` | Execute multiple result sets in one request |
| `/api/query/execute-batch` | Execute a list of statements |
| `/api/query/cancel` | Cancel a running query |
| `/api/query/build-table-select-sql` | Build a table browse query |

### Prepare One Oracle-Family Trigger Definition

`POST /api/query/prepare-oracle-trigger-sql` accepts `{ "input": ... }` with
`databaseType` (`oracle`, `oceanbase-oracle`, or `dameng`), raw `owner`/`name`,
`source`, and `purpose` (`inspect`, `create`, or `replace`). It returns a single
normalized `definition`, the parsed `header`, and independent inline/export
enabled states. This route only prepares SQL; execute through the normal query
route after checking the current object, privileges, and concurrent changes.

`comparisonSource` is for readback comparison only. It canonicalizes the known
declaration wrapper while preserving the remaining header, body, comments, and
literal newlines. Execute `definition`, not this comparison form.

`structuredEditable` reports whether the complete definition's header can be represented without loss by the timing/event/body form. A false or absent value requires the complete-source editor for structural changes; a plain `TRIGGER_BODY` alone does not establish this capability.

For create/replace, supply `binding` with the verified `scope`
(`TABLE`, `VIEW`, `SCHEMA`, `DATABASE`, or `TIMER`), parent `owner`/`name` where
applicable, and `pluggable` for a verified Oracle container scope. Omitted ON
qualifiers are filled only from that binding. Replace also requires the current
desired `enabled` state. Create produces CREATE without OR REPLACE. Oracle and
verified OceanBase preserve state in the definition; DM's
`requiresStateRestore` indicates a separate native state step to preview and
verify. `allowExportAppendix` is only for inspecting trusted metadata exports;
write purposes reject it and any extra SQL.

## Redis APIs

Redis browser and command execution use dedicated routes.

```http
POST /api/redis/execute-command
Content-Type: application/json

{
  "connectionId": "redis-id",
  "db": 0,
  "command": "GET mykey"
}
```

Other common Redis routes:

- `/api/redis/scan-keys`
- `/api/redis/get-value`
- `/api/redis/set-string`
- `/api/redis/delete-key`

## MongoDB APIs

MongoDB routes are `POST` endpoints with JSON bodies.

### List Collections

```http
POST /api/mongo/list-collections
Content-Type: application/json

{
  "connectionId": "mongo-id",
  "database": "app"
}
```

### Find Documents

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

Other MongoDB routes include `aggregate-documents`, `insert-documents`, `update-documents`, and `delete-documents`.


## Writes, Safety, and File Boundaries

- API authentication proves only that the request belongs to a logged-in session; it does not replace database privileges
- Query, import, and transfer paths continue to enforce connection read-only protection, while production and SQL-risk policy apply in their corresponding core paths
- Browser-selected table-import and SQL files are uploaded into server temporary storage, not read from arbitrary client paths
- Web exports create a temporary server file, return it through a download route, and then clean it up
- Reverse proxies should preserve cookies and SSE streaming, allow appropriate long-running timeouts, and limit public exposure

## Example Scripts

See the repository examples:

- [examples/web-api/automation.sh](https://github.com/t8y2/dbx/tree/main/examples/web-api/automation.sh)
- [examples/docker/docker-compose.yml](https://github.com/t8y2/dbx/tree/main/examples/docker/docker-compose.yml)
- [examples/cli/basic-workflow.sh](https://github.com/t8y2/dbx/tree/main/examples/cli/basic-workflow.sh)

## Route Groups

The Web backend exposes many more routes for the UI, including:

- `/api/export/*` for exports and downloads
- `/api/import/*` for table imports
- `/api/transfer/*` for data transfer jobs
- `/api/ai/*` for the built-in AI assistant
- `/api/agents/*` and `/api/jdbc/*` for driver management
- `/api/history/*` and `/api/saved-sql/*` for editor state

Browse `crates/dbx-web/src/main.rs` in the repository for the full route list.
