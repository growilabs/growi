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
      },
    };

    mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({
      'growi.service.type': 'app',
      'growi.deployment.type': 'standalone',
      'growi.attachment.type': 'local',
    });
    expect(mockGrowiInfoService.getGrowiInfo).toHaveBeenCalledWith({
      includeAttachmentInfo: true,
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
    });
  });

  it('should return empty object when growiInfoService throws error', async () => {
    mockGrowiInfoService.getGrowiInfo.mockRejectedValue(
      new Error('Service unavailable'),
    );

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({});
  });
});
