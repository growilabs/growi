import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import { addUserCountsMetrics } from './user-counts-metrics';

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

describe('addUserCountsMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockUserCountGauge = mock<ObservableGauge>();
  const mockActiveUserCountGauge = mock<ObservableGauge>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge
      .mockReturnValueOnce(mockUserCountGauge)
      .mockReturnValueOnce(mockActiveUserCountGauge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create observable gauges and set up metrics collection', () => {
    addUserCountsMetrics();

    expect(metrics.getMeter).toHaveBeenCalledWith(
      'growi-user-counts-metrics',
      '1.0.0',
    );
    expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
      'growi.users.total',
      {
        description: 'Total number of users in GROWI',
        unit: 'users',
      },
    );
    expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
      'growi.users.active',
      {
        description: 'Number of active users in GROWI',
        unit: 'users',
      },
    );
    expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledWith(
      expect.any(Function),
      [mockUserCountGauge, mockActiveUserCountGauge],
    );
  });

  describe('metrics callback behavior', () => {
    const mockGrowiInfo = {
      additionalInfo: {
        currentUsersCount: 150,
        currentActiveUsersCount: 75,
      },
    };

    beforeEach(() => {
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);
    });

    it('should observe user count metrics when growi info is available', async () => {
      const mockResult = { observe: vi.fn() };

      addUserCountsMetrics();

      // Get the callback function that was passed to addBatchObservableCallback
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockGrowiInfoService.getGrowiInfo).toHaveBeenCalledWith({
        includeUserCountInfo: true,
      });
      expect(mockResult.observe).toHaveBeenCalledWith(mockUserCountGauge, 150);
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockActiveUserCountGauge,
        75,
      );
    });

    it('should use default values when user counts are missing', async () => {
      const mockResult = { observe: vi.fn() };

      const growiInfoWithoutCounts = {
        additionalInfo: {
          // Missing currentUsersCount and currentActiveUsersCount
        },
      };
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(
        growiInfoWithoutCounts,
      );

      addUserCountsMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockUserCountGauge, 0);
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockActiveUserCountGauge,
        0,
      );
    });

    it('should handle missing additionalInfo gracefully', async () => {
      const mockResult = { observe: vi.fn() };

      const growiInfoWithoutAdditionalInfo = {
        // Missing additionalInfo entirely
      };
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(
        growiInfoWithoutAdditionalInfo,
      );

      addUserCountsMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockUserCountGauge, 0);
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockActiveUserCountGauge,
        0,
      );
    });

    it('should handle errors in metrics collection gracefully', async () => {
      mockGrowiInfoService.getGrowiInfo.mockRejectedValue(
        new Error('Service unavailable'),
      );
      const mockResult = { observe: vi.fn() };

      addUserCountsMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      // Should not throw error
      await expect(callback(mockResult)).resolves.toBeUndefined();

      // Should not call observe when error occurs
      expect(mockResult.observe).not.toHaveBeenCalled();
    });
  });
});
