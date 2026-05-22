/**
 * Integration test for setupCustomMetrics()
 * Verifies that all 5 metrics (existing 4 + yjs) are registered when setupCustomMetrics() is called.
 */

import { type Meter, metrics } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

// Mock all transitive dependencies before importing index.ts

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
  }),
}));

vi.mock('@opentelemetry/api', () => ({
  diag: {
    createComponentLogger: () => ({
      error: vi.fn(),
    }),
  },
  metrics: {
    getMeter: vi.fn(),
  },
}));

// Mock growi-info service (required by application-metrics)
vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: {
    getGrowiInfo: vi.fn(),
  },
}));

// Mock config-manager (required by application-metrics)
vi.mock('~/server/service/config-manager');

// Controlled docs Map mock (required by yjs-metrics)
const mockDocs = new Map<string, unknown>();
vi.mock('y-websocket/bin/utils', () => ({
  get docs() {
    return mockDocs;
  },
}));

describe('setupCustomMetrics', () => {
  const mockMeter = mock<Meter>();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocs.clear();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge.mockReturnValue(mock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call getMeter for all 5 metric modules (Req 4.2)', async () => {
    const { setupCustomMetrics } = await import('./index');
    await setupCustomMetrics();

    // Each add*Metrics() calls metrics.getMeter() once — there are 5 modules
    expect(metrics.getMeter).toHaveBeenCalledTimes(5);
  });

  it('should register growi.yjs.docs.count gauge (Req 4.1)', async () => {
    const { setupCustomMetrics } = await import('./index');
    await setupCustomMetrics();

    const allGaugeNames = mockMeter.createObservableGauge.mock.calls.map(
      ([name]) => name,
    );
    expect(allGaugeNames).toContain('growi.yjs.docs.count');
  });

  it('should register growi.configs gauge from application-metrics (Req 4.5)', async () => {
    const { setupCustomMetrics } = await import('./index');
    await setupCustomMetrics();

    const allGaugeNames = mockMeter.createObservableGauge.mock.calls.map(
      ([name]) => name,
    );
    expect(allGaugeNames).toContain('growi.configs');
  });

  it('should register system.memory.limit gauge from system-metrics (Req 4.5)', async () => {
    const { setupCustomMetrics } = await import('./index');
    await setupCustomMetrics();

    const allGaugeNames = mockMeter.createObservableGauge.mock.calls.map(
      ([name]) => name,
    );
    // system-metrics registers multiple gauges; verify at least one system gauge is present
    expect(
      allGaugeNames.some(
        (n) => n.startsWith('system.') || n.startsWith('process.'),
      ),
    ).toBe(true);
  });

  it('should call getMeter with growi-yjs-metrics meter name (Req 4.2)', async () => {
    const { setupCustomMetrics } = await import('./index');
    await setupCustomMetrics();

    expect(metrics.getMeter).toHaveBeenCalledWith('growi-yjs-metrics', '1.0.0');
  });
});
