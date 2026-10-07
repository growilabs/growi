import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import { addInstalledAtMetrics } from './installed-at-metrics';

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

const mockGrowiInfoService = {
  getGrowiInfo: vi.fn(),
};
vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: mockGrowiInfoService,
}));

describe('addInstalledAtMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockInstalledAtGauge = mock<ObservableGauge>();
  const mockInstalledAtByOldestUserGauge = mock<ObservableGauge>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge
      .mockReturnValueOnce(mockInstalledAtGauge)
      .mockReturnValueOnce(mockInstalledAtByOldestUserGauge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create observable gauges and set up metrics collection', () => {
    addInstalledAtMetrics();

    expect(metrics.getMeter).toHaveBeenCalledWith(
      'growi-installed-at-metrics',
      '1.0.0',
    );
    expect(mockMeter.createObservableGauge).toHaveBeenNthCalledWith(
      1,
      'growi.installed_at.timestamp.seconds',
      {
        description: 'GROWI installation time as Unix timestamp (seconds)',
        unit: 's',
      },
    );
    expect(mockMeter.createObservableGauge).toHaveBeenNthCalledWith(
      2,
      'growi.installed_at.by_oldest_user.timestamp.seconds',
      {
        description:
          'GROWI installation time inferred from the oldest user as Unix timestamp (seconds)',
        unit: 's',
      },
    );
    expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledWith(
      expect.any(Function),
      [mockInstalledAtGauge, mockInstalledAtByOldestUserGauge],
    );
  });

  describe('metrics callback behavior', () => {
    it('should observe both gauges in unix seconds when both dates exist', async () => {
      const installedAt = new Date('2023-01-01T00:00:00.000Z');
      const installedAtByOldestUser = new Date('2022-06-15T12:30:00.000Z');
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue({
        additionalInfo: {
          installedAt,
          installedAtByOldestUser,
        },
      });
      const mockResult = { observe: vi.fn() };

      addInstalledAtMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockGrowiInfoService.getGrowiInfo).toHaveBeenCalledWith({
        includeInstalledInfo: true,
      });
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockInstalledAtGauge,
        Math.floor(installedAt.getTime() / 1000),
      );
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockInstalledAtByOldestUserGauge,
        Math.floor(installedAtByOldestUser.getTime() / 1000),
      );
    });

    it('should skip observe for missing installedAt', async () => {
      const installedAtByOldestUser = new Date('2022-06-15T12:30:00.000Z');
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue({
        additionalInfo: {
          installedAt: undefined,
          installedAtByOldestUser,
        },
      });
      const mockResult = { observe: vi.fn() };

      addInstalledAtMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).not.toHaveBeenCalledWith(
        mockInstalledAtGauge,
        expect.anything(),
      );
      expect(mockResult.observe).toHaveBeenCalledWith(
        mockInstalledAtByOldestUserGauge,
        Math.floor(installedAtByOldestUser.getTime() / 1000),
      );
    });

    it('should skip both observes when additionalInfo is missing', async () => {
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue({
        additionalInfo: undefined,
      });
      const mockResult = { observe: vi.fn() };

      addInstalledAtMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).not.toHaveBeenCalled();
    });

    it('should swallow errors from growiInfoService gracefully', async () => {
      mockGrowiInfoService.getGrowiInfo.mockRejectedValue(
        new Error('Service unavailable'),
      );
      const mockResult = { observe: vi.fn() };

      addInstalledAtMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      await expect(callback(mockResult)).resolves.toBeUndefined();
      expect(mockResult.observe).not.toHaveBeenCalled();
    });
  });
});
