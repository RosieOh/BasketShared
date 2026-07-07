import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '../config/configuration';
import { NonRetryableError } from '../common/non-retryable.error';
import { TenantUsage } from './tenant-usage.entity';

export interface Quota {
  maxBytes: number;
  maxObjects: number;
}
export interface Usage {
  objectCount: number;
  bytesStored: number;
}

/**
 * Per-tenant quota enforcement + usage metering. Quotas come from config
 * (`TENANT_QUOTAS` map or the QUOTA_DEFAULT_* fallback; 0 = unlimited); usage is
 * an aggregate updated atomically on each successful transfer.
 */
@Injectable()
export class QuotaService {
  private readonly defaultMaxBytes: number;
  private readonly defaultMaxObjects: number;
  private readonly map: Record<string, { maxBytes?: number; maxObjects?: number }>;

  constructor(
    @InjectRepository(TenantUsage) private readonly repo: Repository<TenantUsage>,
    config: ConfigService<AppConfig, true>,
  ) {
    const q = config.get('quotas', { infer: true });
    this.defaultMaxBytes = q.defaultMaxBytes;
    this.defaultMaxObjects = q.defaultMaxObjects;
    this.map = q.map;
  }

  getQuota(tenantId: string): Quota {
    const t = this.map[tenantId] ?? {};
    return {
      maxBytes: t.maxBytes ?? this.defaultMaxBytes,
      maxObjects: t.maxObjects ?? this.defaultMaxObjects,
    };
  }

  async getUsage(tenantId: string): Promise<Usage> {
    const row = await this.repo.findOne({ where: { tenantId } });
    return {
      objectCount: row ? Number(row.objectCount) : 0,
      bytesStored: row ? Number(row.bytesStored) : 0,
    };
  }

  /** Throws NonRetryableError (permanent fail) if this transfer would exceed quota. */
  async assertWithinQuota(tenantId: string, additionalBytes: number): Promise<void> {
    const quota = this.getQuota(tenantId);
    const usage = await this.getUsage(tenantId);
    if (quota.maxBytes > 0 && usage.bytesStored + additionalBytes > quota.maxBytes) {
      throw new NonRetryableError(
        `Storage quota exceeded for tenant '${tenantId}': ${usage.bytesStored}+${additionalBytes} > ${quota.maxBytes} bytes`,
      );
    }
    if (quota.maxObjects > 0 && usage.objectCount + 1 > quota.maxObjects) {
      throw new NonRetryableError(
        `Object quota exceeded for tenant '${tenantId}': ${usage.objectCount}+1 > ${quota.maxObjects} objects`,
      );
    }
  }

  /** Atomic upsert-increment after a successful transfer. */
  async recordUsage(tenantId: string, bytes: number): Promise<void> {
    await this.repo.query(
      `INSERT INTO tenant_usage (tenant_id, object_count, bytes_stored, updated_at)
       VALUES ($1, 1, $2, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         object_count = tenant_usage.object_count + 1,
         bytes_stored = tenant_usage.bytes_stored + $2,
         updated_at = now()`,
      [tenantId, bytes],
    );
  }

  async summary(tenantId: string): Promise<{ tenantId: string; usage: Usage; quota: Quota }> {
    return { tenantId, usage: await this.getUsage(tenantId), quota: this.getQuota(tenantId) };
  }
}
