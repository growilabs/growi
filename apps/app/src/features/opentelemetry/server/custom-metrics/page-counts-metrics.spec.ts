import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import { addPageCountsMetrics } from './page-counts-metrics';

// Mock external dependencies
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

// Mock growi-info service
const mockGrowiInfoService = {
  getGrowiInfo: vi.fn(),
};
vi.mock('~/server/service/growi-info', async () => ({
  growiInfoService: mockGrowiInfoService,
}));

describe('addPageCountsMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockPageCountGauge = mock<ObservableGauge>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge.mockReturnValueOnce(mockPageCountGauge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create observable gauges and set up metrics collection', () => {
    addPageCountsMetrics();

    expect(metrics.getMeter).toHaveBeenCalledWith(
      'growi-page-counts-metrics',
      '1.0.0',
    );
    expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
      'growi.pages.total',
      {
        description: 'Total number of pages in GROWI',
        unit: 'pages',
      },
    );
    expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledWith(
      expect.any(Function),
      [mockPageCountGauge],
    );
  });

  describe('metrics callback behavior', () => {
    const mockGrowiInfo = {
      additionalInfo: {
        currentPagesCount: 1234,
      },
    };

    beforeEach(() => {
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);
    });

    it('should observe page count metrics when growi info is available', async () => {
      const mockResult = { observe: vi.fn() };

      addPageCountsMetrics();

      // Get the callback function that was passed to addBatchObservableCallback
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockGrowiInfoService.getGrowiInfo).toHaveBeenCalledWith({
        includePageCountInfo: true,
      });
      expect(mockResult.observe).toHaveBeenCalledWith(mockPageCountGauge, 1234);
    });

    it('should use default values when page counts are missing', async () => {
      const mockResult = { observe: vi.fn() };

      const growiInfoWithoutCounts = {
        additionalInfo: {
          // Missing currentPagesCount
        },
      };
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(
        growiInfoWithoutCounts,
      );

      addPageCountsMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockPageCountGauge, 0);
    });

    it('should handle missing additionalInfo gracefully', async () => {
      const mockResult = { observe: vi.fn() };

      const growiInfoWithoutAdditionalInfo = {
        // Missing additionalInfo entirely
      };
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(
        growiInfoWithoutAdditionalInfo,
      );

      addPageCountsMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockPageCountGauge, 0);
    });

    it('should handle errors in metrics collection gracefully', async () => {
      mockGrowiInfoService.getGrowiInfo.mockRejectedValue(
        new Error('Service unavailable'),
      );
      const mockResult = { observe: vi.fn() };

      addPageCountsMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      // Should not throw error
      await expect(callback(mockResult)).resolves.toBeUndefined();

      // Should not call observe when error occurs
      expect(mockResult.observe).not.toHaveBeenCalled();
    });
  });
});
