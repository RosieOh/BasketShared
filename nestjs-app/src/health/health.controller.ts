import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { RedisHealthIndicator } from './redis.health-indicator';
import { S3HealthIndicator } from './s3.health-indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly s3: S3HealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness: process is up. Used by the container healthcheck. */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies (Postgres + object storage) are reachable. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('postgres', { timeout: 3000 }),
      () => this.s3.isHealthy('object-storage'),
      () => this.redis.isHealthy('redis'),
    ]);
  }

  /** Full check (alias of readiness for convenience). */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.ready();
  }
}
