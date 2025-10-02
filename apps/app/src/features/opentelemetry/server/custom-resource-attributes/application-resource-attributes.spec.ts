import { getApplicationResourceAttributes } from './application-resource-attributes';

// Mock external dependencies
vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock growi-info service
const mockGrowiInfoService = {
  getGrowiInfo: vi.fn(),
};
vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: mockGrowiInfoService,
}));

describe('getApplicationResourceAttributes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return complete application resource attributes when growi info is available', async () => {
    const mockGrowiInfo = {
      type: 'app',
      deploymentType: 'standalone',
      additionalInfo: {
        attachmentType: 'local',
        installedAt: new Date('2023-01-01T00:00:00.000Z'),
        installedAtByOldestUser: new Date('2023-01-01T00:00:00.000Z'),
      },
    };

    mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({
      'growi.service.type': 'app',
      'growi.deployment.type': 'standalone',
      'growi.attachment.type': 'local',
      'growi.installedAt': '2023-01-01T00:00:00.000Z',
      'growi.installedAt.by_oldest_user': '2023-01-01T00:00:00.000Z',
    });
    expect(mockGrowiInfoService.getGrowiInfo).toHaveBeenCalledWith({
      includeInstalledInfo: true,
    });
  });

  it('should handle missing additionalInfo gracefully', async () => {
    const mockGrowiInfo = {
      type: 'app',
      deploymentType: 'standalone',
      additionalInfo: undefined,
    };

    mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({
      'growi.service.type': 'app',
      'growi.deployment.type': 'standalone',
      'growi.attachment.type': undefined,
      'growi.installedAt': undefined,
      'growi.installedAt.by_oldest_user': undefined,
    });
  });

  it('should return empty object when growiInfoService throws error', async () => {
    mockGrowiInfoService.getGrowiInfo.mockRejectedValue(
      new Error('Service unavailable'),
    );

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({});
  });

  it('should handle partial additionalInfo data', async () => {
    const mockGrowiInfo = {
      type: 'app',
      deploymentType: 'docker',
      additionalInfo: {
        attachmentType: 'gridfs',
        // Missing installedAt and installedAtByOldestUser
      },
    };

    mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({
      'growi.service.type': 'app',
      'growi.deployment.type': 'docker',
      'growi.attachment.type': 'gridfs',
      'growi.installedAt': undefined,
      'growi.installedAt.by_oldest_user': undefined,
    });
  });
});
