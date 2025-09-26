import crypto from 'node:crypto';
import { type Meter, metrics, type ObservableGauge } from '@opentelemetry/api';
import { mock } from 'vitest-mock-extended';

import { configManager } from '~/server/service/config-manager';

import { addApplicationMetrics } from './application-metrics';

// Mock external dependencies
const mockConfigManager = vi.mocked(configManager);
vi.mock('~/server/service/config-manager');
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
vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: mockGrowiInfoService,
}));

describe('addApplicationMetrics', () => {
  const mockMeter = mock<Meter>();
  const mockGauge = mock<ObservableGauge>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metrics.getMeter).mockReturnValue(mockMeter);
    mockMeter.createObservableGauge.mockReturnValue(mockGauge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create observable gauge and set up metrics collection', () => {
    addApplicationMetrics();

    expect(metrics.getMeter).toHaveBeenCalledWith(
      'growi-application-metrics',
      '1.0.0',
    );
    expect(mockMeter.createObservableGauge).toHaveBeenCalledWith(
      'growi.configs',
      {
        description: 'GROWI instance information (always 1)',
        unit: '1',
      },
    );
    expect(mockMeter.addBatchObservableCallback).toHaveBeenCalledWith(
      expect.any(Function),
      [mockGauge],
    );
  });

  describe('metrics callback behavior', () => {
    const testSiteUrl = 'https://example.com';
    const mockGrowiInfo = {
      appSiteUrl: testSiteUrl,
      wikiType: 'open',
      additionalInfo: {
        activeExternalAccountTypes: ['google', 'github'],
      },
    };

    beforeEach(() => {
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);
    });

    it('should observe metrics with site_url when isAppSiteUrlHashed is false', async () => {
      mockConfigManager.getConfig.mockImplementation((key) => {
        if (key === 'otel:isAppSiteUrlHashed') return false;
        return undefined;
      });
      const mockResult = { observe: vi.fn() };

      addApplicationMetrics();

      // Get the callback function that was passed to addBatchObservableCallback
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockConfigManager.getConfig).toHaveBeenCalledWith(
        'otel:isAppSiteUrlHashed',
      );
      expect(mockResult.observe).toHaveBeenCalledWith(mockGauge, 1, {
        site_url: testSiteUrl,
        site_url_hashed: undefined,
        wiki_type: 'open',
        external_auth_types: 'google,github',
      });
    });

    it('should observe metrics with site_url_hashed when isAppSiteUrlHashed is true', async () => {
      mockConfigManager.getConfig.mockImplementation((key) => {
        if (key === 'otel:isAppSiteUrlHashed') return true;
        return undefined;
      });
      const mockResult = { observe: vi.fn() };

      // Calculate expected hash
      const hasher = crypto.createHash('sha256');
      hasher.update(testSiteUrl);
      const expectedHash = hasher.digest('hex');

      addApplicationMetrics();

      // Get the callback function that was passed to addBatchObservableCallback
      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockConfigManager.getConfig).toHaveBeenCalledWith(
        'otel:isAppSiteUrlHashed',
      );
      expect(mockResult.observe).toHaveBeenCalledWith(mockGauge, 1, {
        site_url: '[hashed]',
        site_url_hashed: expectedHash,
        wiki_type: 'open',
        external_auth_types: 'google,github',
      });
    });

    it('should handle empty external auth types', async () => {
      mockConfigManager.getConfig.mockImplementation((key) => {
        if (key === 'otel:isAppSiteUrlHashed') return false;
        return undefined;
      });
      const mockResult = { observe: vi.fn() };

      const growiInfoWithoutAuth = {
        ...mockGrowiInfo,
        additionalInfo: {
          activeExternalAccountTypes: [],
        },
      };
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(growiInfoWithoutAuth);

      addApplicationMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockResult.observe).toHaveBeenCalledWith(mockGauge, 1, {
        site_url: testSiteUrl,
        site_url_hashed: undefined,
        wiki_type: 'open',
        external_auth_types: '',
      });
    });

    it('should handle errors in metrics collection gracefully', async () => {
      mockConfigManager.getConfig.mockImplementation((key) => {
        if (key === 'otel:isAppSiteUrlHashed') return false;
        return undefined;
      });
      mockGrowiInfoService.getGrowiInfo.mockRejectedValue(
        new Error('Service unavailable'),
      );
      const mockResult = { observe: vi.fn() };

      addApplicationMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];

      // Should not throw error
      await expect(callback(mockResult)).resolves.toBeUndefined();

      // Should not call observe when error occurs
      expect(mockResult.observe).not.toHaveBeenCalled();
    });

    it('should handle missing additionalInfo gracefully', async () => {
      mockConfigManager.getConfig.mockImplementation((key) => {
        if (key === 'otel:isAppSiteUrlHashed') return false;
        return undefined;
      });
      const mockResult = { observe: vi.fn() };

      const growiInfoWithoutAdditionalInfo = {
        appSiteUrl: testSiteUrl,
        wikiType: 'open',
        additionalInfo: undefined,
      };
      mockGrowiInfoService.getGrowiInfo.mockResolvedValue(
        growiInfoWithoutAdditionalInfo,
      );

      addApplicationMetrics();

      const callback = mockMeter.addBatchObservableCallback.mock.calls[0][0];
      await callback(mockResult);

      expect(mockConfigManager.getConfig).toHaveBeenCalledWith(
        'otel:isAppSiteUrlHashed',
      );
      expect(mockResult.observe).toHaveBeenCalledWith(mockGauge, 1, {
        site_url: testSiteUrl,
        site_url_hashed: undefined,
        wiki_type: 'open',
        external_auth_types: '',
      });
    });
  });
});
