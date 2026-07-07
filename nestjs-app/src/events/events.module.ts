import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventPublisherService } from './event-publisher.service';
import { EventSubscription } from './entities/event-subscription.entity';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WEBHOOK_DELIVERY_QUEUE } from './webhook-queue';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventSubscription]),
    BullModule.registerQueue({
      name: WEBHOOK_DELIVERY_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [SubscriptionsController],
  providers: [EventPublisherService, SubscriptionsService, WebhookDeliveryProcessor],
  exports: [EventPublisherService],
})
export class EventsModule {}
