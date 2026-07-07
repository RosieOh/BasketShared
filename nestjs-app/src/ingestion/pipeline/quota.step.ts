import { Injectable } from '@nestjs/common';
import { QuotaService } from '../../quota/quota.service';
import { ProcessingContext, ProcessingStep } from './processing-step';

/**
 * Rejects a transfer that would push its tenant over quota (permanent failure).
 * Runs before the upload so no bytes are stored when the tenant is full.
 */
@Injectable()
export class QuotaStep implements ProcessingStep {
  readonly name = 'quota';

  constructor(private readonly quota: QuotaService) {}

  async execute(ctx: ProcessingContext): Promise<void> {
    await this.quota.assertWithinQuota(ctx.transfer.tenantId, ctx.sizeBytes);
  }
}
