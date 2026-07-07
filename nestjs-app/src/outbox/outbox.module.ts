import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TRANSFER_QUEUE } from '../ingestion/queue/transfer-queue';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    BullModule.registerQueue({ name: TRANSFER_QUEUE }),
  ],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
