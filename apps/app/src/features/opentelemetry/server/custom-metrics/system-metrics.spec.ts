import * as os from 'node:os';
import * as v8 from 'node:v8';
import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import { addSystemMetrics } from './system-metrics';

// vi.hoisted ensures the factory runs before vi.mock factories (which are also hoisted).
// This is needed because diag.createComponentLogger() is called at module-load time in
// system-metrics.ts, so the mock must already hold the reference when the module is imported.
const { diagErrorMock } = vi.hoisted(() => ({
  diagErrorMock: { error: vi.fn() },
}));

// Mock external dependencies
vi.mock('node:os', () => ({
  totalmem: vi.fn(),
}));
vi.mock('node:v8', () => ({
  getHeapStatistics: vi.fn(),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
  }),
}));

vi.mock('@opentelemetry/api', () => ({
  diag: {
    createComponentLogger: () => diagErrorMock,
  },
  metrics: {
    getMeter: vi.fn(),
  },
}));

describe('addSystemMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockGauges: ObservableGauge[] = Array.from({ length: 6 }, () =>
    mock<ObservableGauge>(),
  );

  // Assign individual gauges for assertion clarity
  let mockMemoryLimitGauge: ObservableGauge;
  let mockHostMemoryTotalGauge: ObservableGauge;
  let mockProcessMemoryUsageGauge: ObservableGauge;
  let mockV8HeapUsedGauge: ObservableGauge;
  let mockV8HeapTotalGauge: ObservableGauge;
  let mockV8HeapExternalGauge: ObservableGauge;

  beforeEach(() => {
    vi.clearAllMocks();
    diagErrorMock.error.mockReset();

    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);

    // Return different gauge mocks for each createObservableGauge call
    let callCount = 0;
    mockMeter.createObservableGauge.mockImplementation(
      () => mockGauges[callCount++],
    );

    [
      mockMemoryLimitGauge,
      mockHostMemoryTotalGauge,
      mockProcessMemoryUsageGauge,
      mockV8HeapUsedGauge,
      mockV8HeapTotalGauge,
      mockV8HeapExternalGauge,
    ] = mockGauges;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('meter and gauge setup', () => {
    it('should create meter with correct name and version', () => {
      addSystemMetrics();

      expect(metrics.getMeter).toHaveBeenCalledWith(
        'growi-system-metrics',
        '1.0.0',
      );
      expect(metrics.getMeter).toHaveBeenCalledTimes(1);
    });

    it('should create 6 ObservableGauges all with unit By', () => {
      addSystemMetrics();

      expect(mockMeter.createObservableGauge).toHaveBeenCalledTimes(6);

      const calls = mockMeter.createObservableGauge.mock.calls;
      const names = calls.map(([name]) => name);
      expect(names).toContain('system.memory.limit');
      expect(names).toContain('system.host.memory.total');
      expect(names).toContain('process.memory.usage');
      expect(names).toContain('process.runtime.v8.heap.used');
      expect(names).toContain('process.runtime.v8.heap.total');
      expect(names).toContain('process.runtime.v8.heap.external');

      // All gauges must use unit 'By'
      for (const [, options] of calls) {
        expect(options).toMatchObject({ unit: 'By' });
      }
    });

    it('should register a single addBatchObservableCallback with all 6 gauges', () => {
      addSystemMetrics();

      expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledTimes(1);

      const [, gaugeArray] = mockMeter.addBatchObservableCallback.mock.calls[0];
      expect(gaugeArray).toHaveLength(6);
      expect(gaugeArray).toContain(mockMemoryLimitGauge);
      expect(gaugeArray).toContain(mockHostMemoryTotalGauge);
      expect(gaugeArray).toContain(mockProcessMemoryUsageGauge);
      expect(gaugeArray).toContain(mockV8HeapUsedGauge);
      expect(gaugeArray).toContain(mockV8HeapTotalGauge);
      expect(gaugeArray).toContain(mockV8HeapExternalGauge);
    });
  });

  describe('callback behavior — constrainedMemory > 0', () => {
    it('should observe system.memory.limit when constrainedMemory returns a positive value (Req 3.1)', async () => {
      const constrainedMemoryValue = 4_294_967_296; // 4 GiB
      vi.spyOn(process, 'constrainedMemory').mockReturnValue(
        constrainedMemoryValue,
      );
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100_000_000,
        heapUsed: 50_000_000,
        heapTotal: 80_000_000,
        external: 5_000_000,
        arrayBuffers: 1_000_000,
      });
      vi.mocked(os.totalmem).mockReturnValue(8_589_934_592);
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        total_heap_size: 80_000_000,
        total_heap_size_executable: 0,
        total_physical_size: 0,
        total_available_size: 0,
        used_heap_size: 50_000_000,
        heap_size_limit: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
        number_of_native_contexts: 0,
        number_of_detached_contexts: 0,
        total_global_handles_size: 0,
        used_global_handles_size: 0,
        external_memory: 0,
      });

      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(
        mockMemoryLimitGauge,
        constrainedMemoryValue,
      );
    });
  });

  describe('callback behavior — constrainedMemory === 0', () => {
    it('should NOT observe system.memory.limit when constrainedMemory returns 0 (Req 3.2)', async () => {
      vi.spyOn(process, 'constrainedMemory').mockReturnValue(0);
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100_000_000,
        heapUsed: 50_000_000,
        heapTotal: 80_000_000,
        external: 5_000_000,
        arrayBuffers: 1_000_000,
      });
      vi.mocked(os.totalmem).mockReturnValue(8_589_934_592);
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        total_heap_size: 80_000_000,
        total_heap_size_executable: 0,
        total_physical_size: 0,
        total_available_size: 0,
        used_heap_size: 50_000_000,
        heap_size_limit: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
        number_of_native_contexts: 0,
        number_of_detached_contexts: 0,
        total_global_handles_size: 0,
        used_global_handles_size: 0,
        external_memory: 0,
      });

      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      // system.memory.limit must NOT be observed
      expect(mockResult.observe).not.toHaveBeenCalledWith(
        mockMemoryLimitGauge,
        expect.anything(),
      );

      // All other 5 gauges must still be observed
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockHostMemoryTotalGauge,
        expect.any(Number),
      );
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockProcessMemoryUsageGauge,
        expect.any(Number),
      );
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockV8HeapUsedGauge,
        expect.any(Number),
      );
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockV8HeapTotalGauge,
        expect.any(Number),
      );
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockV8HeapExternalGauge,
        expect.any(Number),
      );
      expect(mockResult.observe).toHaveBeenCalledTimes(5);
    });
  });

  describe('callback behavior — metric values', () => {
    beforeEach(() => {
      vi.spyOn(process, 'constrainedMemory').mockReturnValue(0);
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 111_222_333,
        heapUsed: 44_455_566,
        heapTotal: 77_888_999,
        external: 12_345_678,
        arrayBuffers: 1_000_000,
      });
      vi.mocked(os.totalmem).mockReturnValue(16_000_000_000);
      vi.mocked(v8.getHeapStatistics).mockReturnValue({
        total_heap_size: 77_888_999,
        total_heap_size_executable: 0,
        total_physical_size: 0,
        total_available_size: 0,
        used_heap_size: 44_455_566,
        heap_size_limit: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
        number_of_native_contexts: 0,
        number_of_detached_contexts: 0,
        total_global_handles_size: 0,
        used_global_handles_size: 0,
        external_memory: 0,
      });
    });

    it('should observe system.host.memory.total from os.totalmem() (Req 3.3)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(
        mockHostMemoryTotalGauge,
        16_000_000_000,
      );
    });

    it('should observe process.memory.usage from process.memoryUsage().rss (Req 4.1)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(
        mockProcessMemoryUsageGauge,
        111_222_333,
      );
    });

    it('should observe v8.heap.used from v8.getHeapStatistics().used_heap_size (Req 4.2)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(
        mockV8HeapUsedGauge,
        44_455_566,
      );
    });

    it('should observe v8.heap.total from v8.getHeapStatistics().total_heap_size (Req 4.3)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(
        mockV8HeapTotalGauge,
        77_888_999,
      );
    });

    it('should observe v8.heap.external from process.memoryUsage().external (Req 4.4)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(
        mockV8HeapExternalGauge,
        12_345_678,
      );
    });

    it('should call process.memoryUsage() exactly once per callback invocation (efficiency)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(process.memoryUsage).toHaveBeenCalledTimes(1);
    });

    it('should call v8.getHeapStatistics() exactly once per callback invocation (efficiency)', async () => {
      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(v8.getHeapStatistics).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should call loggerDiag.error and not call observe when an error occurs in callback (Req 5.2)', async () => {
      const testError = new Error('Simulated metric collection failure');
      vi.spyOn(process, 'constrainedMemory').mockImplementation(() => {
        throw testError;
      });

      addSystemMetrics();

      const mockResult = { observe: vi.fn() };
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      // Should not throw
      await expect(callback(mockResult)).resolves.toBeUndefined();

      // loggerDiag.error must be called with the error
      expect(diagErrorMock.error).toHaveBeenCalledWith(
        'Failed to collect system metrics',
        { error: testError },
      );

      // observe must never be called
      expect(mockResult.observe).not.toHaveBeenCalled();
    });
  });
});
