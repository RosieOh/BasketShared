import { readFileSync } from 'node:fs';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Coerce common truthy/falsy string spellings ("true"/"1"/"yes") into a boolean
 * so `.env` values validate and inject as real booleans.
 */
const toBoolean = ({ value }: { value: unknown }): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
};

/**
 * Strongly-typed contract for every environment variable the app consumes.
 * Validated once at bootstrap — a bad/missing var fails fast with a clear error
 * instead of surfacing as a mysterious runtime crash later.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // ---- App ----
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  APP_PORT = 3000;

  @IsString()
  @IsNotEmpty()
  WEBHOOK_SECRET!: string;

  // ---- Auth (JWT + RBAC) ----
  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRES_IN = '1h';

  /** Bootstrap admin, seeded on first start if no users exist. */
  @IsString()
  @IsNotEmpty()
  ADMIN_USERNAME = 'admin';

  @IsString()
  @IsNotEmpty()
  ADMIN_PASSWORD!: string;

  @IsIn(LOG_LEVELS as unknown as string[])
  LOG_LEVEL: (typeof LOG_LEVELS)[number] = 'info';

  /** Pretty-print logs (dev only; needs the pino-pretty dev dep). Off => JSON. */
  @Transform(toBoolean)
  @IsBoolean()
  LOG_PRETTY = false;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  TRANSFER_MAX_ATTEMPTS = 3;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRANSFER_RETRY_BACKOFF_MS = 1000;

  @IsString()
  @IsNotEmpty()
  INGESTION_DATA_ROOT!: string;

  // ---- Rate limiting & payload size ----
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  THROTTLE_TTL_MS = 60000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 100;

  /** Max JSON request body size in KB. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAX_PAYLOAD_SIZE_KB = 1024;

  /** Max number of file transfers processed concurrently by the worker. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(256)
  WORKER_CONCURRENCY = 5;

  // ---- Processing pipeline ----
  /** Reject files larger than this (MB). 0 disables the size check. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  MAX_FILE_SIZE_MB = 1024;

  /** Enable the ClamAV antivirus scan step (requires the clamav service). */
  @Transform(toBoolean)
  @IsBoolean()
  AV_ENABLED = false;

  @IsString()
  @IsNotEmpty()
  CLAMAV_HOST = 'clamav';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  CLAMAV_PORT = 3310;

  // ---- Failure alerting ----
  @Transform(toBoolean)
  @IsBoolean()
  ALERTS_ENABLED = false;

  /** Slack-compatible incoming-webhook URL for failure alerts. */
  @IsString()
  @IsOptional()
  ALERT_WEBHOOK_URL?: string;

  // ---- Stuck-transfer recovery sweeper ----
  @Transform(toBoolean)
  @IsBoolean()
  RECOVERY_ENABLED = true;

  /** A PENDING/PROCESSING row idle longer than this is considered stuck (ms). */
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  RECOVERY_STALE_MS = 900000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  RECOVERY_BATCH_SIZE = 50;

  /** Delete terminal audit rows older than this many days. 0 disables. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  AUDIT_RETENTION_DAYS = 0;

  // ---- Redis (BullMQ) ----
  @IsString()
  @IsNotEmpty()
  REDIS_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  // ---- PostgreSQL ----
  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  POSTGRES_PORT = 5432;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB!: string;

  @Transform(toBoolean)
  @IsBoolean()
  DB_SYNCHRONIZE = false;

  @Transform(toBoolean)
  @IsBoolean()
  DB_LOGGING = false;

  // ---- S3 / MinIO ----
  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  @IsString()
  @IsNotEmpty()
  S3_REGION!: string;

  @IsString()
  @IsNotEmpty()
  S3_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  S3_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  S3_SECRET_ACCESS_KEY!: string;

  @Transform(toBoolean)
  @IsBoolean()
  S3_FORCE_PATH_STYLE = true;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  S3_UPLOAD_PART_SIZE_MB = 8;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(64)
  S3_UPLOAD_CONCURRENCY = 4;
}

/**
 * Docker/Vault secrets convention: for any `X_FILE` env var pointing at a file,
 * read its contents into `X` (unless `X` is already set). Runs before validation
 * so both validation and the config factory see the resolved secret. This keeps
 * plaintext secrets out of the environment/compose file.
 */
function resolveFileSecrets(): void {
  for (const key of Object.keys(process.env)) {
    if (!key.endsWith('_FILE')) continue;
    const base = key.slice(0, -'_FILE'.length);
    const path = process.env[key];
    if (!path) continue;
    try {
      // _FILE is authoritative: it overrides any plaintext value for `base`.
      process.env[base] = readFileSync(path, 'utf8').trim();
    } catch {
      // Unreadable: leave `base` as-is; validation surfaces a clear error.
    }
  }
}

/**
 * ConfigModule `validate` hook. Throws (aborting bootstrap) on any violation.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  resolveFileSecrets();
  config = { ...process.env, ...config };

  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
