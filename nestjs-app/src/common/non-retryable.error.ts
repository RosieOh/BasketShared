/**
 * Marks a failure that must NOT be retried (e.g. validation rejection, virus
 * found, oversize file). The worker finalizes these to FAILED immediately
 * instead of throwing them back to BullMQ for another attempt.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
