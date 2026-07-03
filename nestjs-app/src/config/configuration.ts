/**
 * Typed configuration tree. Built from already-validated env vars, then exposed
 * through `ConfigService<AppConfig, true>` so every read is fully typed and
 * non-nullable (no `process.env` access anywhere outside this file).
 */

export interface AppConfig {
  app: {
    nodeEnv: string;
    port: number;
    webhookSecret: string;
    logLevel: string;
    logPretty: boolean;
    transferMaxAttempts: number;
    transferRetryBackoffMs: number;
    ingestionDataRoot: string;
    workerConcurrency: number;
    maxPayloadBytes: number;
  };
  throttle: {
    ttlMs: number;
    limit: number;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
    adminUsername: string;
    adminPassword: string;
  };
  alerts: {
    enabled: boolean;
    webhookUrl?: string;
  };
  recovery: {
    enabled: boolean;
    staleMs: number;
    batchSize: number;
  };
  retention: {
    auditDays: number; // 0 = disabled
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    synchronize: boolean;
    logging: boolean;
  };
  s3: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    uploadPartSizeBytes: number;
    uploadConcurrency: number;
  };
  pipeline: {
    maxFileSizeBytes: number;
    avEnabled: boolean;
    clamavHost: string;
    clamavPort: number;
  };
  routing: {
    rules: RoutingRule[];
  };
}

/** A single routing rule: first match wins; unset fields match anything. */
export interface RoutingRule {
  match: { username?: string; extension?: string; pathPrefix?: string };
  bucket?: string; // defaults to S3_BUCKET when omitted
  prefix?: string; // key prefix, e.g. "incoming/"
}

function parseRoutingRules(raw: string | undefined): RoutingRule[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RoutingRule[]) : [];
  } catch {
    return []; // invalid JSON => no custom routing (default bucket)
  }
}

const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : ['true', '1', 'yes', 'on'].includes(v.toLowerCase());

const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export default (): AppConfig => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: int(process.env.APP_PORT, 3000),
    webhookSecret: process.env.WEBHOOK_SECRET as string,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    logPretty: bool(process.env.LOG_PRETTY, false),
    transferMaxAttempts: int(process.env.TRANSFER_MAX_ATTEMPTS, 3),
    transferRetryBackoffMs: int(process.env.TRANSFER_RETRY_BACKOFF_MS, 1000),
    ingestionDataRoot: process.env.INGESTION_DATA_ROOT as string,
    workerConcurrency: int(process.env.WORKER_CONCURRENCY, 5),
    maxPayloadBytes: int(process.env.MAX_PAYLOAD_SIZE_KB, 1024) * 1024,
  },
  throttle: {
    ttlMs: int(process.env.THROTTLE_TTL_MS, 60000),
    limit: int(process.env.THROTTLE_LIMIT, 100),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET as string,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword: process.env.ADMIN_PASSWORD as string,
  },
  alerts: {
    enabled: bool(process.env.ALERTS_ENABLED, false),
    webhookUrl: process.env.ALERT_WEBHOOK_URL || undefined,
  },
  recovery: {
    enabled: bool(process.env.RECOVERY_ENABLED, true),
    staleMs: int(process.env.RECOVERY_STALE_MS, 900000),
    batchSize: int(process.env.RECOVERY_BATCH_SIZE, 50),
  },
  retention: {
    auditDays: int(process.env.AUDIT_RETENTION_DAYS, 0),
  },
  redis: {
    host: process.env.REDIS_HOST as string,
    port: int(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  database: {
    host: process.env.POSTGRES_HOST as string,
    port: int(process.env.POSTGRES_PORT, 5432),
    username: process.env.POSTGRES_USER as string,
    password: process.env.POSTGRES_PASSWORD as string,
    database: process.env.POSTGRES_DB as string,
    synchronize: bool(process.env.DB_SYNCHRONIZE, false),
    logging: bool(process.env.DB_LOGGING, false),
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION as string,
    bucket: process.env.S3_BUCKET as string,
    accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    uploadPartSizeBytes: int(process.env.S3_UPLOAD_PART_SIZE_MB, 8) * 1024 * 1024,
    uploadConcurrency: int(process.env.S3_UPLOAD_CONCURRENCY, 4),
  },
  pipeline: {
    maxFileSizeBytes: int(process.env.MAX_FILE_SIZE_MB, 1024) * 1024 * 1024,
    avEnabled: bool(process.env.AV_ENABLED, false),
    clamavHost: process.env.CLAMAV_HOST ?? 'clamav',
    clamavPort: int(process.env.CLAMAV_PORT, 3310),
  },
  routing: {
    rules: parseRoutingRules(process.env.ROUTING_RULES),
  },
});
