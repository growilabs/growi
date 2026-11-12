import {
  type Counter,
  type DiagLogger,
  DiagLogLevel,
  diag,
  type Meter,
  type MeterProvider as MeterProviderApi,
  metrics,
} from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
  type ScopeMetrics,
} from '@opentelemetry/sdk-metrics';
import { mock } from 'vitest-mock-extended';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
  }),
}));

const ARCHIVE_METRIC = 'growi.archive.operations';
const G2G_METRIC = 'growi.g2g_transfer.operations';

type SdkHarness = {
  provider: MeterProvider;
  collect: () => Promise<ScopeMetrics[]>;
};

// A real SDK (not a mocked Meter) is required so that a Meter fixed to Noop by
// being obtained before provider registration makes these tests fail.
const registerRealSdk = (): SdkHarness => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.disable();
  metrics.setGlobalMeterProvider(provider);

  return {
    provider,
    collect: async () => {
      await reader.forceFlush();
      const exported = exporter.getMetrics();
      return exported.at(-1)?.scopeMetrics ?? [];
    },
  };
};

const findMetric = (
  scopeMetrics: ScopeMetrics[],
  name: string,
): MetricData | undefined =>
  scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === name);

const pointsOf = (metric: MetricData | undefined) =>
  (metric?.dataPoints ?? []).map((dp) => ({
    attributes: dp.attributes,
    value: dp.value,
  }));

const importModule = () => {
  vi.resetModules();
  return import('./data-transfer-usage-metrics');
};

describe('data-transfer-usage-metrics', () => {
  let harness: SdkHarness | undefined;

  afterEach(async () => {
    await harness?.provider.shutdown();
    harness = undefined;
    metrics.disable();
    diag.disable();
  });

  it('exports archive operation counts per operation and result as a monotonic counter', async () => {
    const mod = await importModule();
    harness = registerRealSdk();
    mod.addDataTransferUsageMetrics();

    mod.recordArchiveOperation('create', 'success');
    mod.recordArchiveOperation('create', 'success');
    mod.recordArchiveOperation('create', 'failure');

    const scopeMetrics = await harness.collect();
    const scope = scopeMetrics.find(
      (s) => s.scope.name === 'growi-data-transfer-usage-metrics',
    );
    expect(scope?.scope.version).toBe('1.0.0');

    const archive = findMetric(scopeMetrics, ARCHIVE_METRIC);
    expect(archive?.descriptor.unit).toBe('{operation}');
    expect(archive?.dataPointType).toBe(DataPointType.SUM);
    expect(
      archive?.dataPointType === DataPointType.SUM && archive.isMonotonic,
    ).toBe(true);
    expect(pointsOf(archive)).toEqual(
      expect.arrayContaining([
        { attributes: { operation: 'create', result: 'success' }, value: 2 },
        { attributes: { operation: 'create', result: 'failure' }, value: 1 },
      ]),
    );
    expect(pointsOf(archive)).toHaveLength(2);
  });

  it('exports G2G transfers as separate series per role, isolated from the archive metric', async () => {
    const mod = await importModule();
    harness = registerRealSdk();
    mod.addDataTransferUsageMetrics();

    mod.recordG2GTransfer('source', 'success');
    mod.recordG2GTransfer('destination', 'failure');
    mod.recordArchiveOperation('import', 'success');

    const scopeMetrics = await harness.collect();
    const g2g = findMetric(scopeMetrics, G2G_METRIC);
    const archive = findMetric(scopeMetrics, ARCHIVE_METRIC);

    expect(g2g?.descriptor.unit).toBe('{transfer}');
    expect(g2g?.dataPointType === DataPointType.SUM && g2g.isMonotonic).toBe(
      true,
    );
    expect(pointsOf(g2g)).toEqual(
      expect.arrayContaining([
        { attributes: { role: 'source', result: 'success' }, value: 1 },
        { attributes: { role: 'destination', result: 'failure' }, value: 1 },
      ]),
    );
    expect(pointsOf(g2g)).toHaveLength(2);
    expect(pointsOf(archive)).toEqual([
      { attributes: { operation: 'import', result: 'success' }, value: 1 },
    ]);
  });

  it('does not export records made before the counters are created, and does not throw', async () => {
    const mod = await importModule();

    expect(() => {
      mod.recordArchiveOperation('upload', 'success');
      mod.recordG2GTransfer('source', 'success');
    }).not.toThrow();

    harness = registerRealSdk();
    mod.addDataTransferUsageMetrics();
    mod.recordArchiveOperation('upload', 'success');

    const scopeMetrics = await harness.collect();
    expect(pointsOf(findMetric(scopeMetrics, ARCHIVE_METRIC))).toEqual([
      { attributes: { operation: 'upload', result: 'success' }, value: 1 },
    ]);
    expect(pointsOf(findMetric(scopeMetrics, G2G_METRIC))).toEqual([]);
  });

  it('limits exported attribute keys to operation, role and result', async () => {
    const mod = await importModule();
    harness = registerRealSdk();
    mod.addDataTransferUsageMetrics();

    mod.recordArchiveOperation('create', 'success');
    mod.recordArchiveOperation('download', 'success');
    mod.recordArchiveOperation('upload', 'failure');
    mod.recordArchiveOperation('import', 'failure');
    mod.recordG2GTransfer('source', 'failure');
    mod.recordG2GTransfer('destination', 'success');

    const scopeMetrics = await harness.collect();
    const archiveKeys = pointsOf(findMetric(scopeMetrics, ARCHIVE_METRIC)).map(
      (p) => Object.keys(p.attributes).sort(),
    );
    const g2gKeys = pointsOf(findMetric(scopeMetrics, G2G_METRIC)).map((p) =>
      Object.keys(p.attributes).sort(),
    );

    expect(archiveKeys).toHaveLength(4);
    expect(archiveKeys).toEqual(Array(4).fill(['operation', 'result']));
    expect(g2gKeys).toHaveLength(2);
    expect(g2gKeys).toEqual(Array(2).fill(['result', 'role']));
  });

  it('swallows an exception from the counter and logs it via diag', async () => {
    const mod = await importModule();
    const throwingCounter = mock<Counter>();
    throwingCounter.add.mockImplementation(() => {
      throw new Error('add failed');
    });
    const meter = mock<Meter>();
    meter.createCounter.mockReturnValue(throwingCounter);
    const provider = mock<MeterProviderApi>();
    provider.getMeter.mockReturnValue(meter);
    metrics.disable();
    metrics.setGlobalMeterProvider(provider);
    const diagLogger = mock<DiagLogger>();
    diag.setLogger(diagLogger, DiagLogLevel.ALL);

    mod.addDataTransferUsageMetrics();

    expect(() => mod.recordArchiveOperation('create', 'success')).not.toThrow();
    expect(() => mod.recordG2GTransfer('source', 'success')).not.toThrow();
    expect(throwingCounter.add).toHaveBeenCalledTimes(2);
    expect(diagLogger.error).toHaveBeenCalledTimes(2);
  });
});
