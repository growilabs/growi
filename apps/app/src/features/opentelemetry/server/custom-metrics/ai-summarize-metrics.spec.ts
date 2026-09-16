import { type Counter, type Meter, metrics } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import {
  addAiSummarizeMetrics,
  incrementAiSummarizeGeneratedCount,
} from './ai-summarize-metrics';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
  }),
}));
vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: vi.fn(),
  },
}));

describe('ai-summarize-metrics', () => {
  const mockMeter = mock<Meter>();
  const mockCounter = mock<Counter>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createCounter.mockReturnValue(mockCounter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('incrementAiSummarizeGeneratedCount before addAiSummarizeMetrics() is called', () => {
    it('does not throw when the module has only been imported, never initialized', () => {
      expect(() => incrementAiSummarizeGeneratedCount()).not.toThrow();
    });

    it('does not call metrics.getMeter merely by importing the module', async () => {
      // The static import at the top of this file already loaded the module once,
      // before this test's vi.clearAllMocks() ran in beforeEach — so asserting
      // against that stale call history would pass regardless of whether the
      // implementation calls getMeter() at module top level. Force a fresh module
      // evaluation instead, with the mock call history cleared immediately before it,
      // so this actually detects a getMeter() call reintroduced at module top level.
      vi.resetModules();
      vi.mocked(metrics.getMeter).mockClear();

      await import('./ai-summarize-metrics');

      expect(metrics.getMeter).not.toHaveBeenCalled();
    });
  });

  describe('addAiSummarizeMetrics', () => {
    it('creates the Counter inside the function via metrics.getMeter(), not at module top level', () => {
      // getMeter must not have been called merely by importing the module (see the "before" describe above).
      addAiSummarizeMetrics();

      expect(metrics.getMeter).toHaveBeenCalledTimes(1);
      expect(mockMeter.createCounter).toHaveBeenCalledWith(
        'growi.ai.summarize.generated',
        expect.objectContaining({ unit: '1' }),
      );
    });

    it('increments the Counter by 1 each time incrementAiSummarizeGeneratedCount() is called', () => {
      addAiSummarizeMetrics();

      incrementAiSummarizeGeneratedCount();

      expect(mockCounter.add).toHaveBeenCalledTimes(1);
      expect(mockCounter.add).toHaveBeenCalledWith(1, expect.any(Object));
    });

    it('does not include user-identifying or page-content attributes on increment', () => {
      addAiSummarizeMetrics();

      incrementAiSummarizeGeneratedCount();

      const [, attributes] = mockCounter.add.mock.calls[0];
      const keys = Object.keys(attributes ?? {});
      const forbiddenKeyPattern = /user|page|content|body|path/i;
      expect(keys.some((key) => forbiddenKeyPattern.test(key))).toBe(false);
    });
  });
});
