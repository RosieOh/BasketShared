import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import { TransferStatus } from '../ingestion/entities/file-transfer.entity';

/** Typed facade over the transfer metrics so callers don't touch prom-client. */
@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric('syncbridge_transfers_total')
    private readonly transfersTotal: Counter<string>,
    @InjectMetric('syncbridge_transfer_bytes_total')
    private readonly bytesTotal: Counter<string>,
    @InjectMetric('syncbridge_transfer_duration_seconds')
    private readonly duration: Histogram<string>,
    @InjectMetric('syncbridge_transfers_in_flight')
    private readonly inFlight: Gauge<string>,
    @InjectMetric('syncbridge_dead_letter_total')
    private readonly deadLetter: Counter<string>,
    @InjectMetric('syncbridge_webhook_deliveries_total')
    private readonly webhookDeliveries: Counter<string>,
  ) {}

  /** Start a duration timer; call the returned fn once the transfer finalizes. */
  startTimer(): () => void {
    return this.duration.startTimer();
  }

  incInFlight(): void {
    this.inFlight.inc();
  }

  decInFlight(): void {
    this.inFlight.dec();
  }

  recordSuccess(bytes: number): void {
    this.transfersTotal.inc({ status: TransferStatus.SUCCESS });
    this.bytesTotal.inc(bytes);
  }

  recordFailure(): void {
    this.transfersTotal.inc({ status: TransferStatus.FAILED });
  }

  recordDeadLetter(): void {
    this.deadLetter.inc();
  }

  recordWebhookDelivery(status: 'delivered' | 'failed'): void {
    this.webhookDeliveries.inc({ status });
  }
}
