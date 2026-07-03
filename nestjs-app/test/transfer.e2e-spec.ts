import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CreateBucketCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

/**
 * Full-stack integration test: real Postgres, Redis, and MinIO (via
 * Testcontainers) with the actual NestJS app. Drives the webhook → BullMQ
 * worker → S3 pipeline end to end and asserts the object lands in the bucket.
 */
describe('Transfer pipeline (e2e)', () => {
  jest.setTimeout(240_000);

  let app: INestApplication;
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let minio: StartedTestContainer;
  let s3: S3Client;
  let dataRoot: string;

  const BUCKET = 'ingested-files';
  const WEBHOOK_SECRET = 'e2e-secret';
  const ADMIN_KEY = 'e2e-admin';

  beforeAll(async () => {
    [pg, redis, minio] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('syncbridge')
        .withUsername('syncbridge')
        .withPassword('syncbridge')
        .start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('minio/minio:RELEASE.2025-04-22T22-12-26Z')
        .withCommand(['server', '/data'])
        .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start(),
    ]);

    const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    s3 = new S3Client({
      region: 'us-east-1',
      endpoint: s3Endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

    dataRoot = await mkdtemp(join(tmpdir(), 'syncbridge-e2e-'));

    const redisUrl = new URL(redis.getConnectionUrl());
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_PORT: '3999', // unused (app.init() doesn't bind), but must pass validation
      WEBHOOK_SECRET,
      ADMIN_API_KEY: ADMIN_KEY,
      LOG_LEVEL: 'error',
      LOG_PRETTY: 'false',
      INGESTION_DATA_ROOT: dataRoot,
      WORKER_CONCURRENCY: '2',
      TRANSFER_MAX_ATTEMPTS: '2',
      TRANSFER_RETRY_BACKOFF_MS: '200',
      MAX_FILE_SIZE_MB: '100',
      AV_ENABLED: 'false',
      CLAMAV_HOST: 'localhost',
      CLAMAV_PORT: '3310',
      RECOVERY_ENABLED: 'false',
      REDIS_HOST: redisUrl.hostname,
      REDIS_PORT: redisUrl.port,
      POSTGRES_HOST: pg.getHost(),
      POSTGRES_PORT: String(pg.getPort()),
      POSTGRES_USER: 'syncbridge',
      POSTGRES_PASSWORD: 'syncbridge',
      POSTGRES_DB: 'syncbridge',
      DB_SYNCHRONIZE: 'true', // e2e: auto-create schema instead of migrations
      DB_LOGGING: 'false',
      S3_ENDPOINT: s3Endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET: BUCKET,
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadmin',
      S3_FORCE_PATH_STYLE: 'true',
      S3_UPLOAD_PART_SIZE_MB: '8',
      S3_UPLOAD_CONCURRENCY: '4',
    });

    // AppModule is imported lazily so it reads the env set above.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop(), minio?.stop()]);
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  it('ingests an SFTP upload webhook and lands the object in S3 as SUCCESS', async () => {
    const userDir = join(dataRoot, 'alice');
    await mkdir(userDir, { recursive: true });
    const filePath = join(userDir, 'data.csv');
    const content = 'id,name\n1,e2e\n';
    await writeFile(filePath, content);
    const size = (await stat(filePath)).size;

    const server = app.getHttpServer();

    // 1. Webhook accepted (immediate 200).
    const res = await request(server)
      .post('/v1/sftp/on-upload')
      .set('X-SyncBridge-Token', WEBHOOK_SECRET)
      .send({
        action: 'upload',
        username: 'alice',
        path: filePath,
        virtual_path: '/data.csv',
        file_size: size,
        status: 1,
        protocol: 'SFTP',
        session_id: 'e2e-1',
        timestamp: 1,
      })
      .expect(200);
    expect(res.body.outcome).toBe('accepted');

    // 2. Poll the management API until the worker finalizes the transfer.
    const transfer = await pollForSuccess(server);
    expect(transfer.status).toBe('SUCCESS');
    expect(transfer.objectKey).toBe('alice/data.csv');
    expect(transfer.checksumSha256).toHaveLength(64);

    // 3. The object really exists in MinIO with the right bytes.
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'alice/data.csv' }));
    expect(await obj.Body!.transformToString()).toBe(content);
  });

  it('rejects an unauthenticated webhook with 401', async () => {
    await request(app.getHttpServer())
      .post('/v1/sftp/on-upload')
      .send({ action: 'upload', username: 'x', path: join(dataRoot, 'x'), virtual_path: '/x', file_size: 1, status: 1 })
      .expect(401);
  });

  async function pollForSuccess(server: unknown, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const list = await request(server as never)
        .get('/v1/transfers?limit=1')
        .set('X-Admin-Token', ADMIN_KEY)
        .expect(200);
      const item = list.body.items?.[0];
      if (item && (item.status === 'SUCCESS' || item.status === 'FAILED')) return item;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Transfer did not finalize within timeout');
  }
});
