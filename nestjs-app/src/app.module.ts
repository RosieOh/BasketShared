import { BullModule } from '@nestjs/bullmq';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import configuration, { AppConfig } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AdminUiModule } from './admin-ui/admin-ui.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    // Structured JSON logging (pretty-printed in dev). Secrets are redacted and
    // noisy health/metrics probes are excluded from request logs.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const app = config.get('app', { infer: true });
        return {
          pinoHttp: {
            level: app.logLevel,
            // JSON by default; pretty only when explicitly enabled (dev), since
            // pino-pretty is a dev-only dependency absent from the prod image.
            transport: app.logPretty
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
              : undefined,
            redact: [
              'req.headers.authorization',
              'req.headers["x-admin-token"]',
              'req.headers["x-syncbridge-token"]',
              'req.query.token',
            ],
            autoLogging: true,
            quietReqLogger: true,
          },
          exclude: [
            { method: RequestMethod.GET, path: 'health' },
            { method: RequestMethod.GET, path: 'health/live' },
            { method: RequestMethod.GET, path: 'health/ready' },
            { method: RequestMethod.GET, path: 'metrics' },
          ],
        };
      },
    }),
    // Distributed job queue (BullMQ over Redis) — the async worker transport.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const redis = config.get('redis', { infer: true });
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
          },
        };
      },
    }),
    // Drives the periodic stuck-transfer recovery sweep.
    ScheduleModule.forRoot(),
    // Global rate limiting (per-IP) — protects the webhook & management API.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const t = config.get('throttle', { infer: true });
        return { throttlers: [{ ttl: t.ttlMs, limit: t.limit }] };
      },
    }),
    // Prometheus /metrics + custom transfer metrics (global).
    MetricsModule,
    NotificationsModule,
    DatabaseModule,
    AuthModule,
    StorageModule,
    IngestionModule,
    HealthModule,
    AdminUiModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
