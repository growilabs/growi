import { getOsResourceAttributes } from './os-resource-attributes';

// Mock Node.js os module with proper Vitest mock functions
vi.mock('node:os', () => ({
  type: vi.fn(),
  platform: vi.fn(),
  arch: vi.fn(),
}));

describe('getOsResourceAttributes', () => {
  let mockOs: {
    type: ReturnType<typeof vi.fn>;
    platform: ReturnType<typeof vi.fn>;
    arch: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Get the mocked os module
    mockOs = await vi.importMock('node:os');
  });

  it('should return OS resource attributes with correct structure', () => {
    // Setup mock values
    const mockOsData = {
      type: 'Linux',
      platform: 'linux' as const,
      arch: 'x64',
    };

    mockOs.type.mockReturnValue(mockOsData.type);
    mockOs.platform.mockReturnValue(mockOsData.platform);
    mockOs.arch.mockReturnValue(mockOsData.arch);

    const result = getOsResourceAttributes();

    expect(result).toEqual({
      'os.type': 'Linux',
      'os.platform': 'linux',
      'os.arch': 'x64',
    });
    expect(result).not.toHaveProperty('os.totalmem');
  });

  it('should call all required os module functions', () => {
    // Set up mock returns to avoid undefined values
    mockOs.type.mockReturnValue('Linux');
    mockOs.platform.mockReturnValue('linux');
    mockOs.arch.mockReturnValue('x64');

    getOsResourceAttributes();

    expect(mockOs.type).toHaveBeenCalledOnce();
    expect(mockOs.platform).toHaveBeenCalledOnce();
    expect(mockOs.arch).toHaveBeenCalledOnce();
  });

  it('should handle different OS types correctly', () => {
    const testCases = [
      {
        input: {
          type: 'Windows_NT',
          platform: 'win32',
          arch: 'x64',
        },
        expected: {
          'os.type': 'Windows_NT',
          'os.platform': 'win32',
          'os.arch': 'x64',
        },
      },
      {
        input: {
          type: 'Darwin',
          platform: 'darwin',
          arch: 'arm64',
        },
        expected: {
          'os.type': 'Darwin',
          'os.platform': 'darwin',
          'os.arch': 'arm64',
        },
      },
    ];

    testCases.forEach(({ input, expected }) => {
      mockOs.type.mockReturnValue(input.type);
      mockOs.platform.mockReturnValue(input.platform as NodeJS.Platform);
      mockOs.arch.mockReturnValue(input.arch);

      const result = getOsResourceAttributes();
      expect(result).toEqual(expected);
      expect(result).not.toHaveProperty('os.totalmem');
    });
  });
});
