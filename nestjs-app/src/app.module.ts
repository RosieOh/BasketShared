import { BullModule } from '@nestjs/bullmq';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import configuration, { AppConfig } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MetricsModule } from './metrics/metrics.module';
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
    // Prometheus /metrics + custom transfer metrics (global).
    MetricsModule,
    DatabaseModule,
    StorageModule,
    IngestionModule,
    HealthModule,
  ],
})
export class AppModule {}
