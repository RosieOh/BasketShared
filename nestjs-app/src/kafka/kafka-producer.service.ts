import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import type { AppConfig } from '../config/configuration';

/**
 * Publishes domain events to Kafka as an event backbone for downstream consumers
 * (analytics, other services). Gated by KAFKA_ENABLED — a no-op when disabled, so
 * the base stack runs without a broker.
 */
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly enabled: boolean;
  private readonly topic: string;
  private producer?: Producer;
  private ready = false;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const k = config.get('kafka', { infer: true });
    this.enabled = k.enabled;
    this.topic = k.eventsTopic;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    const k = this.config.get('kafka', { infer: true });
    const kafka = new Kafka({ clientId: k.clientId, brokers: k.brokers });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    try {
      await this.producer.connect();
      this.ready = true;
      this.logger.log(`Kafka producer connected -> ${k.brokers.join(',')} topic=${this.topic}`);
    } catch (err) {
      // Don't crash the app if the broker isn't up; publishing will retry-on-next.
      this.logger.error(`Kafka connect failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) await this.producer.disconnect().catch(() => undefined);
  }

  /** Publish an event keyed by tenant (best-effort; never throws to the caller). */
  async publish(key: string, value: Record<string, unknown>): Promise<void> {
    if (!this.enabled || !this.producer) return;
    try {
      if (!this.ready) {
        await this.producer.connect();
        this.ready = true;
      }
      await this.producer.send({
        topic: this.topic,
        messages: [{ key, value: JSON.stringify(value) }],
      });
    } catch (err) {
      this.logger.warn(`Kafka publish failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
