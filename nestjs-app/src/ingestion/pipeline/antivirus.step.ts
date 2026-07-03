import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { NonRetryableError } from '../../common/non-retryable.error';
import { scanFileWithClamd } from './clamd.client';
import { ProcessingContext, ProcessingStep } from './processing-step';

/**
 * Streams the file to ClamAV (clamd) for scanning. A detected virus is a
 * permanent failure (NonRetryableError). If clamd is unreachable the error is
 * retryable — a transient outage shouldn't let unscanned files through, so the
 * job retries rather than passing. Disabled by default (`AV_ENABLED`).
 */
@Injectable()
export class AntivirusStep implements ProcessingStep {
  readonly name = 'antivirus';
  private readonly logger = new Logger(AntivirusStep.name);
  private readonly enabled: boolean;
  private readonly host: string;
  private readonly port: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const p = config.get('pipeline', { infer: true });
    this.enabled = p.avEnabled;
    this.host = p.clamavHost;
    this.port = p.clamavPort;
  }

  async execute(ctx: ProcessingContext): Promise<void> {
    if (!this.enabled) return;

    const result = await scanFileWithClamd(this.host, this.port, ctx.sourcePath);
    if (!result.clean) {
      // Permanent: never upload an infected object.
      throw new NonRetryableError(`Virus detected: ${result.signature ?? 'unknown'}`);
    }
    this.logger.log(`AV clean: ${ctx.transfer.filename}`);
  }
}
