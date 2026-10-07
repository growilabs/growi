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

  it('should return only service and deployment type attributes when growi info is available', async () => {
    const mockGrowiInfo = {
      type: 'app',
      deploymentType: 'standalone',
    };

    mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);

    const result = await getApplicationResourceAttributes();

    expect(result).toEqual({
      'growi.service.type': 'app',
      'growi.deployment.type': 'standalone',
    });
    expect(result).not.toHaveProperty('growi.attachment.type');
    expect(mockGrowiInfoService.getGrowiInfo).toHaveBeenCalledWith({});
  });

  it('should not include growi.attachment.type even when additionalInfo is present', async () => {
    const mockGrowiInfo = {
      type: 'app',
      deploymentType: 'standalone',
      additionalInfo: {
        attachmentType: 'local',
      },
    };

    mockGrowiInfoService.getGrowiInfo.mockResolvedValue(mockGrowiInfo);

    const result = await getApplicationResourceAttributes();

    expect(result).not.toHaveProperty('growi.attachment.type');
    expect(result).toEqual({
      'growi.service.type': 'app',
      'growi.deployment.type': 'standalone',
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
