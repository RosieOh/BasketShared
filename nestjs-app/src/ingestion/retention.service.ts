import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AppConfig } from '../config/configuration';
import { FileTransferRepository } from './file-transfer.repository';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Audit-log retention: once a day, purge terminal transfer rows older than
 * AUDIT_RETENTION_DAYS. Object retention in the bucket is handled separately by
 * an S3 lifecycle (ILM) rule configured in the minio-init container.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly repository: FileTransferRepository,
    config: ConfigService<AppConfig, true>,
  ) {
    this.retentionDays = config.get('retention.auditDays', { infer: true });
  }

  onModuleInit(): void {
    this.logger.log(
      this.retentionDays > 0
        ? `Audit retention enabled: purging terminal rows older than ${this.retentionDays} day(s)`
        : 'Audit retention disabled (AUDIT_RETENTION_DAYS=0)',
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purge(): Promise<void> {
    if (this.retentionDays <= 0) return;
    const cutoff = new Date(Date.now() - this.retentionDays * MS_PER_DAY);
    const removed = await this.repository.deleteTerminalOlderThan(cutoff);
    if (removed > 0) this.logger.log(`Retention purge removed ${removed} audit row(s)`);
  }
}
