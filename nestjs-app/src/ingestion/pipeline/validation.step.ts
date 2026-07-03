import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { NonRetryableError } from '../../common/non-retryable.error';
import { ProcessingContext, ProcessingStep } from './processing-step';

/**
 * Rejects files that violate policy (empty, or over the size limit). Violations
 * are permanent — retrying won't change the file — so they raise NonRetryableError.
 */
@Injectable()
export class ValidationStep implements ProcessingStep {
  readonly name = 'validation';
  private readonly logger = new Logger(ValidationStep.name);
  private readonly maxBytes: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.maxBytes = config.get('pipeline.maxFileSizeBytes', { infer: true });
  }

  async execute(ctx: ProcessingContext): Promise<void> {
    if (ctx.sizeBytes <= 0) {
      throw new NonRetryableError('File is empty');
    }
    if (this.maxBytes > 0 && ctx.sizeBytes > this.maxBytes) {
      throw new NonRetryableError(
        `File size ${ctx.sizeBytes} exceeds limit ${this.maxBytes} bytes`,
      );
    }
    this.logger.debug(`Validated ${ctx.transfer.filename} (${ctx.sizeBytes} bytes)`);
  }
}
