import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHmac } from 'node:crypto';
import { MetricsService } from '../metrics/metrics.service';
import { WEBHOOK_DELIVERY_QUEUE, WebhookDeliveryJob } from './webhook-queue';

/**
 * Delivers an event to a subscriber URL with an HMAC-SHA256 signature header.
 * A non-2xx response throws so BullMQ retries with backoff (queue defaults).
 */
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(private readonly metrics: MetricsService) {
    super();
  }

  async process(job: Job<WebhookDeliveryJob>): Promise<void> {
    const { url, secret, event } = job.data;
    const body = JSON.stringify(event);
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SyncBridge-Event': event.type,
          'X-SyncBridge-Signature': `sha256=${signature}`,
        },
        body,
      });
      if (!res.ok) throw new Error(`subscriber returned ${res.status}`);
      this.metrics.recordWebhookDelivery('delivered');
      this.logger.debug(`Delivered ${event.type} -> ${url}`);
    } catch (err) {
      this.metrics.recordWebhookDelivery('failed');
      this.logger.warn(`Delivery to ${url} failed (attempt ${job.attemptsMade + 1}): ${err instanceof Error ? err.message : err}`);
      throw err; // retry
    }
  }
}
