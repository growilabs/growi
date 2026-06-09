import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import { addYjsMetrics, getDocsCount } from './yjs-metrics';

// Mock external dependencies
vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
  }),
}));

const { mockDiagError } = vi.hoisted(() => ({
  mockDiagError: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  diag: {
    createComponentLogger: vi.fn(() => ({ error: mockDiagError })),
  },
  metrics: {
    getMeter: vi.fn(),
  },
}));

// Controlled docs Map mock
const mockDocs = new Map<string, unknown>();
vi.mock('y-websocket/bin/utils', () => ({
  get docs() {
    return mockDocs;
  },
}));

describe('addYjsMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockGauge = mock<ObservableGauge>();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocs.clear();
    mockDiagError.mockReset();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge.mockReturnValue(mockGauge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('meter and gauge setup', () => {
    it('should create meter with correct name and version', () => {
      addYjsMetrics();

      expect(metrics.getMeter).toHaveBeenCalledWith(
        'growi-yjs-metrics',
        '1.0.0',
      );
      expect(metrics.getMeter).toHaveBeenCalledTimes(1);
    });

    it('should create ObservableGauge with name growi.yjs.docs.count (Req 4.1)', () => {
      addYjsMetrics();

      expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
        'growi.yjs.docs.count',
        expect.objectContaining({ unit: '{document}' }),
      );
    });

    it('should create ObservableGauge with unit {document} (Req 4.2)', () => {
      addYjsMetrics();

      const [, options] = mockMeter.createObservableGauge.mock.calls[0];
      expect(options).toMatchObject({ unit: '{document}' });
    });

    it('should create ObservableGauge with an appropriate description', () => {
      addYjsMetrics();

      const [name, options] = mockMeter.createObservableGauge.mock.calls[0];
      expect(name).toBe('growi.yjs.docs.count');
      expect(options?.description).toBeTruthy();
      expect(typeof options?.description).toBe('string');
    });

    it('should register a callback via addBatchObservableCallback (Req 4.2)', () => {
      addYjsMetrics();

      expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledTimes(1);
      const [, gaugeArray] = mockMeter.addBatchObservableCallback.mock.calls[0];
      expect(gaugeArray).toContain(mockGauge);
    });
  });

  describe('callback behavior — docs.size reflects current count', () => {
    it('should observe 0 when docs is empty (Req 4.1)', async () => {
      mockDocs.clear(); // size === 0

      addYjsMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockGauge, 0);
    });

    it('should observe docs.size when docs has N entries (Req 4.1)', async () => {
      mockDocs.set('doc-1', {});
      mockDocs.set('doc-2', {});
      mockDocs.set('doc-3', {});

      addYjsMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockGauge, 3);
    });

    it('should reflect updated docs.size across multiple callback invocations', async () => {
      addYjsMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      // First invocation — no docs
      await callback(mockResult);
      expect(mockResult.observe).toHaveBeenLastCalledWith(mockGauge, 0);

      // Add docs and invoke again
      mockDocs.set('doc-a', {});
      mockDocs.set('doc-b', {});
      await callback(mockResult);
      expect(mockResult.observe).toHaveBeenLastCalledWith(mockGauge, 2);
    });

    it('does not propagate errors and logs via diag when observation throws', async () => {
      addYjsMetrics();

      const throwingResult = {
        observe: vi.fn().mockImplementation(() => {
          throw new Error('otel observe failed');
        }),
      };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      await expect(async () => callback(throwingResult)).not.toThrow();
      expect(mockDiagError).toHaveBeenCalledWith(
        expect.stringContaining('yjs'),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('getDocsCount — defensive helper', () => {
    it('should return 0 when docs is undefined (Req design: defensive check)', () => {
      expect(getDocsCount(undefined)).toBe(0);
    });

    it('should return 0 when docs is null (Req design: defensive check)', () => {
      expect(getDocsCount(null)).toBe(0);
    });

    it('should return 0 when docs is an empty map', () => {
      expect(getDocsCount(new Map())).toBe(0);
    });

    it('should return the map size when docs has entries', () => {
      const m = new Map<string, unknown>([
        ['a', {}],
        ['b', {}],
        ['c', {}],
      ]);
      expect(getDocsCount(m)).toBe(3);
    });
  });
});
