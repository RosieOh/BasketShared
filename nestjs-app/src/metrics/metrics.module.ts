import { Global, Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';

/**
 * Exposes GET /metrics (Prometheus text format) including default process
 * metrics, and provides typed custom metrics via MetricsService. Global so the
 * worker can record without re-importing.
 */
@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      defaultLabels: { app: 's3-syncbridge' },
    }),
  ],
  providers: [
    MetricsService,
    makeCounterProvider({
      name: 'syncbridge_transfers_total',
      help: 'Count of completed transfers by terminal status',
      labelNames: ['status'],
    }),
    makeCounterProvider({
      name: 'syncbridge_transfer_bytes_total',
      help: 'Total bytes successfully uploaded to object storage',
    }),
    makeHistogramProvider({
      name: 'syncbridge_transfer_duration_seconds',
      help: 'End-to-end processing time per transfer',
      buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
    }),
    makeGaugeProvider({
      name: 'syncbridge_transfers_in_flight',
      help: 'Transfers accepted by the worker but not yet finalized',
    }),
    makeCounterProvider({
      name: 'syncbridge_dead_letter_total',
      help: 'Transfers routed to the dead-letter queue',
    }),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
