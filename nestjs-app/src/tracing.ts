/**
 * OpenTelemetry bootstrap. MUST be imported before any instrumented module
 * (see main.ts — it is the very first import). Auto-instruments HTTP, Express,
 * pg, ioredis, and the AWS SDK; exports OTLP/HTTP to a collector (Jaeger).
 *
 * Gated by OTEL_ENABLED so the app runs fine with no collector present.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

function isEnabled(): boolean {
  return ['true', '1', 'yes', 'on'].includes((process.env.OTEL_ENABLED ?? '').toLowerCase());
}

if (isEnabled()) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://jaeger:4318';
  const sdk = new NodeSDK({
    resource: new Resource({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 's3-syncbridge',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are far too noisy for this workload.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
  // eslint-disable-next-line no-console
  console.log(`[otel] tracing enabled -> ${endpoint}`);

  const shutdown = () => {
    sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
