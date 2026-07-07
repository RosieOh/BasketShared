# S3-SyncBridge

An event-driven pipeline that ingests files over SFTP and replicates them into
S3-compatible object storage, orchestrated by a NestJS middleware that owns all
business logic, auditing, and fault tolerance.

```
  SFTP client
      │ (1) upload  :2022
      ▼
  ┌─────────┐   (2) on_upload webhook (HTTP)   ┌──────────────────────┐
  │ SFTPGo  │ ───────────────────────────────► │  NestJS Orchestrator  │
  └─────────┘                                   │  - validate + ack 200 │
      │ writes file                             │  - idempotent record  │
      ▼                                         │  - enqueue job ──────────► Redis (BullMQ)
  shared volume  ◄──── (5) read (ro) ────────── │  - worker consumes ◄─────────────┘
  (sftpgo_data)                                 │    pipeline → S3      │
                                                └──────────┬───────────┘
                                (3) audit / (4) validate·scan·enrich·stream upload
                                                           ▼            ▼
                                                    ┌───────────┐  ┌─────────┐
                                                    │ PostgreSQL │  │  MinIO  │
                                                    │  (status)  │  │  (S3)   │
                                                    └───────────┘  └─────────┘
```

| Concern | Choice |
| --- | --- |
| Ingestion | **SFTPGo** (`:2022` SFTP, `:8080` admin) |
| Object storage | **MinIO** (`:9000` API, `:9001` console) — drop-in for AWS S3 |
| Orchestrator | **NestJS 10** (Node 20), AWS SDK v3 |
| Job queue / worker | **BullMQ over Redis 7** — distributed, retries, survives restarts |
| State / audit | **PostgreSQL 16** via TypeORM (migrations, no `synchronize`) |
| Processing pipeline | pluggable steps: validation → ClamAV (opt-in) → enrichment |
| API docs | **Swagger / OpenAPI** at `/docs` |
| Observability | pino JSON logs · Prometheus `/metrics` · Grafana dashboard (opt-in) |
| Tests / CI | Jest unit + **Testcontainers** E2E · GitHub Actions |
| AuthN / AuthZ | **JWT + RBAC** (admin/operator/viewer) on the management API |
| Reliable publishing | **Transactional outbox** (no dual-write between DB + queue) |
| Encryption | **AES-256-GCM envelope** client-side object encryption (optional) |
| Multi-tenancy | tenant isolation via **PostgreSQL Row-Level Security** |
| Resilience ops | **Dead-letter queue** + failure alerts (Slack webhook) + Alertmanager |
| Tracing | **OpenTelemetry** → Jaeger (webhook→worker→S3 in one trace) |
| Retrieval | **Download API** with on-the-fly decryption, tenant-scoped |
| Integration | outbound **signed webhooks** + **Kafka** event backbone + **Debezium CDC** |
| Quotas | per-tenant storage/object **quotas** + usage metering |
| Admin UI | self-contained dashboard at `/ui` (browse, download, retry) |
| Orchestration | **Kubernetes** manifests + **KEDA** queue-depth autoscaling (`k8s/`) |

> The worker runs on **BullMQ over Redis**, so the pipeline retries natively,
> survives restarts, and scales horizontally across orchestrator instances.
> Two extras are behind Compose **profiles** (off by default):
> `--profile av` (ClamAV) and `--profile monitoring` (Prometheus + Grafana +
> Alertmanager + Jaeger).

---

## 1. Quick start

```bash
# 1. Create your env file and edit the secrets.
cp .env.example .env

# 2. Build and start the whole stack.
docker compose up -d --build

# 3. Watch the orchestrator come up (runs migrations, then listens).
docker compose logs -f nestjs-app
```

Readiness checks:

```bash
curl http://localhost:${APP_HOST_PORT}/health/ready   # {"status":"ok", info: {postgres, object-storage}}
```

Service endpoints (host ports come from `.env`; **internal** ports are fixed so
containers always talk to each other on the same address):

| Service | Host URL (`.env` var) | Internal | Credentials |
| --- | --- | --- | --- |
| SFTPGo SFTP | `localhost:${SFTPGO_SFTP_PORT}` | `sftpgo:2022` | user `alice` (created below) |
| SFTPGo admin | `http://localhost:${SFTPGO_HTTP_PORT}` | `sftpgo:8080` | `SFTPGO_ADMIN_USER` / `SFTPGO_ADMIN_PASSWORD` |
| MinIO API | `http://localhost:${MINIO_API_PORT}` | `minio:9000` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| MinIO console | `http://localhost:${MINIO_CONSOLE_PORT}` | `minio:9001` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| Orchestrator | `http://localhost:${APP_HOST_PORT}` | `nestjs-app:3000` | — |
| Admin UI | `http://localhost:${APP_HOST_PORT}/ui` | — | login (JWT) |
| API docs (Swagger) | `http://localhost:${APP_HOST_PORT}/docs` | — | — |
| Postgres | `localhost:${POSTGRES_HOST_PORT}` (loopback) | `postgres:5432` | `POSTGRES_USER` / `POSTGRES_PASSWORD` |
| Redis | `localhost:${REDIS_HOST_PORT}` (loopback) | `redis:6379` | — |
| Grafana (profile: monitoring) | `http://localhost:${GRAFANA_HOST_PORT}` | `grafana:3000` | `GRAFANA_USER` / `GRAFANA_PASSWORD` |
| Prometheus (profile: monitoring) | `http://localhost:${PROMETHEUS_HOST_PORT}` (loopback) | `prometheus:9090` | — |
| Alertmanager (profile: monitoring) | `http://localhost:${ALERTMANAGER_HOST_PORT}` (loopback) | `alertmanager:9093` | — |
| Jaeger (profile: monitoring) | `http://localhost:${JAEGER_UI_HOST_PORT}` | `jaeger:16686` | — |

> **Host-port conflicts.** Only the *published* (host) side is configurable; the
> internal ports never change. `.env.example` uses canonical ports; the shipped
> `.env` remaps the ones that commonly collide on a dev box
> (`APP_HOST_PORT=13000`, `MINIO_API_PORT=19000`, `SFTPGO_HTTP_PORT=18080`,
> `POSTGRES_HOST_PORT=15432`). Adjust these if they clash on your machine.

---

## 2. Infrastructure integration guide

### 2.1 MinIO — bucket & access keys

The `minio-init` container creates the bucket (`S3_BUCKET`) automatically on
first boot and enables versioning. Nothing manual is required for local use.

For a **least-privilege** setup (recommended before production):

1. Open the console at http://localhost:9001 and log in as the root user.
2. **Access Keys → Create access key.** Save the pair.
3. **Identity → Policies → Create policy** scoped to the bucket:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:AbortMultipartUpload"],
         "Resource": ["arn:aws:s3:::ingested-files", "arn:aws:s3:::ingested-files/*"]
       }
     ]
   }
   ```
4. Attach the policy to the access key, then put that key/secret in `.env`
   (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) and `docker compose up -d nestjs-app`.

### 2.2 SFTPGo — webhook & users

**The upload webhook is already wired** via environment variables in
`docker-compose.yml`:

```yaml
SFTPGO_COMMON__ACTIONS__EXECUTE_ON: upload
SFTPGO_COMMON__ACTIONS__HOOK: "http://nestjs-app:3000/v1/sftp/on-upload?token=<WEBHOOK_SECRET>"
```

This global "common action" hook POSTs a JSON payload to the orchestrator after
every successful upload. The shared secret travels as the `token` query param
because the legacy hook cannot set custom headers.

> **Production-grade alternative — Event Manager (custom header).**
> In the SFTPGo admin UI go to **Event Manager → Event rules → Add**:
> - **Trigger:** `Filesystem events`, Action `upload`.
> - **Action:** `HTTP`, Method `POST`, Body `JSON`,
>   Endpoint `http://nestjs-app:3000/v1/sftp/on-upload`.
> - **Headers:** add `X-SyncBridge-Token: <WEBHOOK_SECRET>`.
> The guard accepts the secret from either the header or the query param, so you
> can switch to this without touching the orchestrator. If you use it, unset the
> two `SFTPGO_COMMON__ACTIONS__*` env vars to avoid double delivery.

The first admin is auto-provisioned from `SFTPGO_ADMIN_USER`/`SFTPGO_ADMIN_PASSWORD`
(this requires `SFTPGO_DATA_PROVIDER__CREATE_DEFAULT_ADMIN=true`, already set in
compose), so the web setup screen is skipped.

**Create an SFTP user** (UI: **Users → Add**, or REST API below — `$SFTPGO_HTTP_PORT`
is the host web port, `18080` in the shipped `.env`):

```bash
# Get an admin token, then create a user whose home lives on the shared volume.
TOKEN=$(curl -s -u "$SFTPGO_ADMIN_USER:$SFTPGO_ADMIN_PASSWORD" \
  http://localhost:$SFTPGO_HTTP_PORT/api/v2/token | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s -X POST http://localhost:$SFTPGO_HTTP_PORT/api/v2/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
        "username": "alice",
        "password": "alice-password",
        "status": 1,
        "permissions": { "/": ["*"] },
        "home_dir": "/srv/sftpgo/data/alice"
      }'
```

### 2.3 End-to-end test

```bash
echo "hello s3-syncbridge" > sample.txt

# Interactive upload — you'll be prompted for alice's password.
sftp -P $SFTPGO_SFTP_PORT alice@localhost <<'EOF'
put sample.txt
bye
EOF
```

> **Automating the upload?** `sftp -b` forces BatchMode, which disables password
> auth — so a scripted/`sshpass` password upload will fail. For non-interactive
> uploads, register an SSH public key on the user (`public_keys` field) and
> connect with `sftp -i <key>`. (This is how the verified end-to-end run drove it.)

Then verify the result:

```bash
# Orchestrator logs show: Accepted -> PutObject -> SUCCESS (with etag + sha256)
docker compose logs --tail=20 nestjs-app

# Audit row in Postgres
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT filename, status, attempts, object_key, etag, checksum_sha256 FROM file_transfers ORDER BY created_at DESC LIMIT 5;"

# Object present in MinIO (minio-init has exited, so run a throwaway mc client)
docker run --rm --network s3-syncbridge_syncbridge-net --entrypoint sh minio/mc:RELEASE.2025-04-16T18-13-26Z \
  -c "mc alias set local http://minio:9000 \"$MINIO_ROOT_USER\" \"$MINIO_ROOT_PASSWORD\" && mc ls -r local/$S3_BUCKET"
```

You should see `alice/sample.txt` in the bucket and a `SUCCESS` row whose `etag`
equals the object's MD5 (integrity verified).

### 2.4 Management API (operations)

Protected by **JWT + RBAC** (see §2.10 to obtain `$TOKEN`). Lets operators
inspect history and re-drive failures without touching the database.

```bash
H="Authorization: Bearer $TOKEN"

# List (newest first); filter + paginate
curl -s -H "$H" "http://localhost:$APP_HOST_PORT/v1/transfers?status=FAILED&limit=20&offset=0"

# Inspect one
curl -s -H "$H" "http://localhost:$APP_HOST_PORT/v1/transfers/<id>"

# Re-drive a FAILED/stuck transfer (resets attempts, re-queues the worker).
# Returns 409 if the transfer already succeeded.
curl -s -X POST -H "$H" "http://localhost:$APP_HOST_PORT/v1/transfers/<id>/retry"
```

### 2.5 API docs (Swagger / OpenAPI)

Interactive docs are served at `http://localhost:$APP_HOST_PORT/docs` (raw spec
at `/docs-json`). Both auth schemes (`X-SyncBridge-Token`, `X-Admin-Token`) are
declared, so you can authorize and try requests from the UI.

### 2.6 Processing pipeline

Before upload, each transfer runs through ordered, pluggable steps
(`src/ingestion/pipeline/`) — the concrete realization of the loose-coupling goal:

1. **Validation** — reject empty/oversize files (`MAX_FILE_SIZE_MB`). Violations
   are permanent (no retry).
2. **Antivirus** — stream to ClamAV (clamd INSTREAM). A hit is a permanent
   failure; clamd being unreachable is retryable (unscanned files never pass).
   Off by default — enable with `AV_ENABLED=true` and `--profile av`.
3. **Enrichment** — derive the object `Content-Type` from the extension.

Add a step by implementing `ProcessingStep` and registering it in the ordered
`PROCESSING_STEPS` provider — the worker doesn't change.

### 2.7 Queue, retries & horizontal scaling

The worker is a **BullMQ processor over Redis**. Retries (`TRANSFER_MAX_ATTEMPTS`)
and exponential backoff (`TRANSFER_RETRY_BACKOFF_MS`) are native job options;
concurrency is `WORKER_CONCURRENCY`. Jobs persist in Redis, so they survive
restarts and **scale horizontally** — run more `nestjs-app` replicas and they
share the queue. The recovery sweeper (`RECOVERY_*`) reconciles any DB rows left
`PENDING`/`PROCESSING` by a crash, re-enqueueing them for at-least-once delivery.

### 2.8 Observability

- **Structured logs.** JSON via `nestjs-pino` (secrets redacted; health/metrics
  probes excluded). Set `LOG_PRETTY=true` locally for human-readable output —
  it's off in the container because `pino-pretty` is a dev-only dependency.
- **Metrics.** Prometheus exposition at `GET /metrics`: default process metrics
  plus `syncbridge_transfers_total{status}`, `syncbridge_transfer_bytes_total`,
  `syncbridge_transfer_duration_seconds`, `syncbridge_transfers_in_flight`.
- **Dashboards.** `docker compose --profile monitoring up -d` starts Prometheus
  (scrapes `nestjs-app:3000/metrics`) and Grafana with a provisioned
  "S3-SyncBridge" dashboard (datasource pre-wired). Grafana:
  `http://localhost:${GRAFANA_HOST_PORT}` (admin/admin by default).

### 2.9 Testing & CI

- **Unit tests** (`npm test`): ingestion, retry/management, pipeline steps, routing.
- **E2E** (`npm run test:e2e`): **Testcontainers** spins up real Postgres, Redis,
  and MinIO, boots the app, and drives login → webhook → worker → S3 end to end.
- **CI** (`.github/workflows/ci.yml`): build + unit + E2E on Node 20, plus a
  Docker image build and a full `docker compose config` validation.

### 2.10 Auth & RBAC

The management API is protected by **JWT** with **role-based access**
(admin/operator/viewer). A bootstrap admin is seeded on first start from
`ADMIN_USERNAME`/`ADMIN_PASSWORD`.

```bash
# Log in, then call the API with the Bearer token.
TOKEN=$(curl -s -X POST http://localhost:$APP_HOST_PORT/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'$ADMIN_PASSWORD'"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:$APP_HOST_PORT/v1/transfers"
```

Roles: `viewer` reads; `operator`/`admin` can retry. `retry-batch` re-drives many
at once:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"FAILED","before":"2026-01-01T00:00:00Z","limit":500}' \
  "http://localhost:$APP_HOST_PORT/v1/transfers/retry-batch"
```

### 2.11 Admin dashboard

A self-contained UI is served at `http://localhost:$APP_HOST_PORT/ui` — log in,
browse transfers, and retry failures (single or batch) from the browser.

### 2.12 Dead-letter queue & alerting

Permanently-failed transfers are pushed to a **dead-letter queue**
(`file-transfers-dlq`); a processor increments `syncbridge_dead_letter_total` and
fires a failure alert. Set `ALERTS_ENABLED=true` + `ALERT_WEBHOOK_URL` (Slack
incoming webhook) to deliver them; otherwise they're logged. With
`--profile monitoring`, **Alertmanager** also receives Prometheus alert rules
(`monitoring/alert.rules.yml`).

### 2.13 Distributed tracing

Set `OTEL_ENABLED=true` and run `--profile monitoring` to export OpenTelemetry
traces to **Jaeger** (`http://localhost:${JAEGER_UI_HOST_PORT}`). HTTP, pg, Redis,
and S3 calls are auto-instrumented, and the webhook trace is propagated into the
worker job so one upload is a single end-to-end trace (`transfer.process` span).

### 2.14 Hardening & lifecycle

- **Secrets**: any `<VAR>_FILE` env var is read from that file at boot
  (Docker/Vault secrets). See `docker-compose.secrets.yml`.
- **Rate limiting**: per-IP throttling (`THROTTLE_LIMIT`/`THROTTLE_TTL_MS`) +
  request-body cap (`MAX_PAYLOAD_SIZE_KB`).
- **Multi-destination routing**: `ROUTING_RULES` (JSON) sends files to different
  buckets/prefixes by username/extension/path — first match wins.
- **Retention**: `AUDIT_RETENTION_DAYS` purges old DB rows daily;
  `S3_LIFECYCLE_DAYS` sets an object-expiry ILM rule on the bucket.

### 2.15 Transactional outbox (reliable publishing)

Accepting a webhook writes the `file_transfers` row **and** an `outbox_events`
row in one DB transaction; a relay (`OutboxService`) then publishes committed
events to BullMQ. This eliminates the dual-write window between the DB insert and
`queue.add` — either both commit or neither does. Publishing is at-least-once and
the idempotent worker absorbs any duplicate.

### 2.16 Object encryption (envelope, AES-256-GCM)

With `ENCRYPTION_ENABLED=true` (+ `ENCRYPTION_KEK` = base64 32 bytes), each object
is encrypted client-side before upload: a per-object Data Encryption Key encrypts
the stream (AES-256-GCM), and the DEK is wrapped with the master key and stored
(`wrapped_dek`). Stored layout is `[IV || ciphertext || authTag]` (+28 bytes) —
the same envelope pattern as S3 SSE-KMS, no external KMS required.

### 2.17 Multi-tenancy with PostgreSQL RLS

Transfers carry a `tenant_id` (resolved from the SFTP username via `TENANT_MAP`).
The management API is tenant-isolated by **Row-Level Security**: tenant users run
inside a transaction that sets `app.current_tenant`, so the DB policy filters rows
to their tenant; platform admins bypass. Enforcement is in the database, not just
the app. **Note:** the app connects as a dedicated **non-superuser** role
(`APP_DB_USER`, created by `postgres-init/`) because superusers bypass RLS.
Admins manage tenant users via `POST /v1/users`.

### 2.18 Kubernetes + KEDA autoscaling

`k8s/` holds reference manifests (namespace, config/secret, Postgres/Redis/MinIO,
a migration Job, the orchestrator, Ingress) plus a **KEDA `ScaledObject`** that
autoscales the orchestrator on the BullMQ queue depth
(`bull:file-transfers:wait` in Redis). Deploy with `kubectl apply -k k8s/`. See
[k8s/README.md](k8s/README.md) (incl. the RWX-storage note for SFTP ingestion).

### 2.19 Download API (with decryption)

`GET /v1/transfers/:id/download` streams the stored object back, **decrypting on
the fly** (streaming AES-256-GCM) if it was encrypted — tenant-scoped by RLS, so
users only reach their own objects. The admin UI adds a Download button.

### 2.20 Outbound events (signed webhooks + Kafka)

Terminal transfers emit `transfer.completed` / `transfer.failed`. Tenants
register subscriptions (`POST /v1/subscriptions`); each event is delivered to
matching subscribers as a **signed webhook** (`X-SyncBridge-Signature:
sha256=HMAC`) via a BullMQ delivery queue with retries. The same events are also
published to a **Kafka** topic (`syncbridge.events`) as an event backbone —
enable with `KAFKA_ENABLED=true` and `--profile streaming`.

### 2.21 Change Data Capture (Debezium)

With `--profile streaming`, **Debezium** (Kafka Connect) captures Postgres row
changes on `file_transfers`, `outbox_events`, and `tenant_usage` via logical
replication and streams them to Kafka topics (`syncbridge.cdc.*`) — a foundation
for analytics, replication, and audit pipelines. Connector config:
[streaming/register-postgres.json](streaming/register-postgres.json).

### 2.22 Per-tenant quotas & metering

Storage/object usage is metered per tenant (`tenant_usage`); a pipeline step
rejects uploads that would exceed the tenant's quota (`TENANT_QUOTAS` /
`QUOTA_DEFAULT_*`, 0 = unlimited) as a permanent failure. Inspect via
`GET /v1/usage`.

---

## 3. How the orchestrator satisfies the constraints

### Loose coupling
SFTPGo never talks to MinIO. It only emits an HTTP event; the orchestrator owns
the transfer and is the single place to add validation, AV scanning, or
enrichment later (drop new steps into `IngestionProcessor`).

### Non-blocking ingestion
`IngestionController` validates the payload, writes one fast `PENDING` row,
enqueues a BullMQ job, and returns **200 immediately**. The SFTP session never
waits on object-storage latency. The heavy lifting runs in `IngestionProcessor`
(a BullMQ worker) — off the request path and off the SFTP process entirely.

### Idempotency (duplicate webhooks)
Each event is hashed into a deterministic `idempotency_key`
(`username|virtual_path|size|timestamp|session`). It has a **UNIQUE index**; a
re-delivered webhook collides on insert and is acknowledged as a no-op. The
worker also skips any transfer already in `SUCCESS`.

### Fault tolerance
- **Standard S3 mechanism + large files:** objects up to one part are written
  with a single `PutObjectCommand`; larger ones use a managed multipart `Upload`
  (both AWS SDK v3). `createReadStream` → S3 keeps memory flat regardless of size.
- **Integrity verification:** the worker streams the source once to compute MD5
  and SHA-256. The SHA-256 is stored (`checksum_sha256`) as the canonical record;
  for single-part uploads the MD5 is compared against the returned ETag and a
  mismatch fails the attempt.
- **Backpressure:** the BullMQ worker's concurrency is capped at
  `WORKER_CONCURRENCY`; excess jobs wait in Redis instead of exhausting
  DB/socket/memory.
- **Crash recovery:** jobs live in Redis and survive restarts; on top of that a
  scheduled sweeper (`RECOVERY_*`) re-enqueues DB rows left `PENDING`/`PROCESSING`
  once they pass `RECOVERY_STALE_MS`, and finalizes retry-exhausted ones as
  `FAILED` — giving effective at-least-once delivery.
- **Transient vs permanent failures:** transient errors throw and BullMQ retries
  with exponential backoff up to `TRANSFER_MAX_ATTEMPTS`; validation/AV
  rejections raise `NonRetryableError` and fail immediately (no wasted retries).
- **Permanent failures:** a missing/unreadable source or exhausted retries marks
  the row `FAILED` with the error in `error_log`.
- **Path-traversal defense:** the absolute `path` from the webhook is resolved
  and confirmed to stay within `INGESTION_DATA_ROOT` before any disk read.
- **Auth:** the webhook is protected by a constant-time shared-secret check.

### Clean architecture
```
src/
  config/        env validation (class-validator) + typed config tree
  common/        cross-cutting: exception filter · checksum util · NonRetryableError
  database/      DataSource, DatabaseModule, migrations
  storage/       S3 client provider + StorageService (storage-agnostic facade)
  metrics/       Prometheus module + MetricsService (custom transfer metrics)
  ingestion/     controller/service · processor (BullMQ worker) · recovery sweeper
                 · transfers (management API) · queue/ · pipeline/ (validation,
                 antivirus, content-type) · repository · DTOs · guards · entity
  health/        Terminus liveness/readiness (+ S3 & Redis indicators)
test/            Testcontainers E2E (postgres + redis + minio)
```

---

## 4. Switching MinIO → AWS S3

No code changes. In `.env`:

```bash
S3_ENDPOINT=                 # leave empty → SDK uses the real regional endpoint
S3_REGION=eu-west-1
S3_BUCKET=my-prod-bucket
S3_FORCE_PATH_STYLE=false    # AWS uses virtual-hosted-style addressing
S3_ACCESS_KEY_ID=...         # or remove creds entirely to use an IAM role
S3_SECRET_ACCESS_KEY=...
```

---

## 5. Database migrations

Migrations run automatically on container start (`docker-entrypoint.sh`). To work
with them locally:

```bash
cd nestjs-app
npm run migration:run                 # apply (uses src/database/data-source.ts)
npm run migration:generate -- src/database/migrations/<Name>
npm run migration:revert
```

`synchronize` is hard-disabled — schema only ever changes through reviewed
migrations.

---

## 6. Scaling & remaining hardening

The worker already runs on **BullMQ over Redis**, so to scale out you just run
more `nestjs-app` replicas — they share the queue, and BullMQ distributes jobs
with per-job retries. The recovery sweeper reconciles orphaned DB rows.

Sensible next steps for a production deployment:
- **Secrets management** — move `.env` secrets to Docker/Swarm secrets or Vault.
- **Rate limiting** — add `@nestjs/throttler` on the webhook.
- **Alerting** — Prometheus Alertmanager rules on `syncbridge_transfers_total{status="FAILED"}`.
- **Tracing** — OpenTelemetry spans across webhook → worker → S3.
- **Retention** — S3 lifecycle policies and periodic archival of old audit rows.

---

## 7. Operations cheatsheet

```bash
docker compose ps                      # service + health status
docker compose logs -f nestjs-app      # orchestrator logs
docker compose down                    # stop (keeps volumes/data)
docker compose down -v                 # stop and WIPE all data
```
