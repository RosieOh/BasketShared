import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { FileTransfer } from '../ingestion/entities/file-transfer.entity';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { EventSubscription } from './entities/event-subscription.entity';
import {
  EventType,
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
  WebhookDeliveryJob,
} from './webhook-queue';

/**
 * Fans a domain event out to the tenant's active subscriptions by enqueueing one
 * delivery job per subscriber. Delivery (with retries) happens in the worker.
 */
@Injectable()
export class EventPublisherService {
  private readonly logger = new Logger(EventPublisherService.name);

  constructor(
    @InjectRepository(EventSubscription) private readonly subs: Repository<EventSubscription>,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly queue: Queue<WebhookDeliveryJob>,
    private readonly kafka: KafkaProducerService,
  ) {}

  async publishTransferEvent(
    transfer: FileTransfer,
    type: EventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Event backbone: publish to Kafka for downstream consumers (no-op if off).
    await this.kafka.publish(transfer.tenantId, {
      type,
      transferId: transfer.id,
      tenantId: transfer.tenantId,
      data,
    });

    const subscriptions = await this.subs.find({
      where: { tenantId: transfer.tenantId, active: true },
    });
    const targets = subscriptions.filter((s) => s.events.includes(type));
    for (const s of targets) {
      await this.queue.add(WEBHOOK_DELIVERY_JOB, {
        subscriptionId: s.id,
        url: s.url,
        secret: s.secret,
        event: { type, transferId: transfer.id, tenantId: transfer.tenantId, data },
      });
    }
    if (targets.length > 0) {
      this.logger.debug(`Fanned ${type} to ${targets.length} subscriber(s) [tenant=${transfer.tenantId}]`);
    }
  }
}
