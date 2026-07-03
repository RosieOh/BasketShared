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

  /** Shared secret for the management API (X-Admin-Token header). */
  @IsString()
  @IsNotEmpty()
  ADMIN_API_KEY!: string;

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
 * ConfigModule `validate` hook. Throws (aborting bootstrap) on any violation.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
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
