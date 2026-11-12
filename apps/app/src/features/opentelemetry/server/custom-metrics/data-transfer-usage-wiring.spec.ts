import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: { getGrowiInfo: vi.fn() },
}));
vi.mock('~/server/service/config-manager');
vi.mock('y-websocket/bin/utils', () => ({ docs: new Map() }));

const ARCHIVE_METRIC = 'growi.archive.operations';
const G2G_METRIC = 'growi.g2g_transfer.operations';

describe('data transfer usage metrics wiring', () => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });

  const collectMetricNames = async (): Promise<string[]> => {
    await reader.forceFlush();
    const scopeMetrics = exporter.getMetrics().at(-1)?.scopeMetrics ?? [];
    return scopeMetrics
      .flatMap((scope) => scope.metrics)
      .map((metric: MetricData) => metric.descriptor.name);
  };

  beforeAll(() => {
    metrics.disable();
    metrics.setGlobalMeterProvider(provider);
  });

  afterAll(async () => {
    metrics.disable();
    await provider.shutdown();
  });

  it('records via the public barrel only after setupCustomMetrics() has run (Req 11.7)', async () => {
    const { recordArchiveOperation, recordG2GTransfer } = await import(
      '../index'
    );

    // Telemetry not yet set up: recording is a silent no-op (Req 11.8)
    expect(() => recordArchiveOperation('create', 'success')).not.toThrow();
    expect(() => recordG2GTransfer('source', 'failure')).not.toThrow();
    expect(await collectMetricNames()).not.toContain(ARCHIVE_METRIC);

    const { setupCustomMetrics } = await import('./index');
    await setupCustomMetrics();

    recordArchiveOperation('download', 'success');
    recordG2GTransfer('destination', 'success');

    const names = await collectMetricNames();
    expect(names).toContain(ARCHIVE_METRIC);
    expect(names).toContain(G2G_METRIC);
  });
});
