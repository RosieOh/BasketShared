import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROCESSING_STEPS, ProcessingContext, ProcessingStep } from './processing-step';

/**
 * Runs the ordered processing steps against a context. Each step may enrich the
 * context or throw to abort; the first throw stops the pipeline and propagates
 * (NonRetryableError => permanent, anything else => retryable) to the worker.
 */
@Injectable()
export class ProcessingPipeline {
  private readonly logger = new Logger(ProcessingPipeline.name);

  constructor(@Inject(PROCESSING_STEPS) private readonly steps: ProcessingStep[]) {}

  async run(ctx: ProcessingContext): Promise<void> {
    for (const step of this.steps) {
      await step.execute(ctx);
    }
    this.logger.debug(
      `Pipeline complete for ${ctx.transfer.filename} [${this.steps.map((s) => s.name).join(' -> ')}]`,
    );
  }
}
