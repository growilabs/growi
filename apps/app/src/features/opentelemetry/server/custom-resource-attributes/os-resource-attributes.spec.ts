import { getOsResourceAttributes } from './os-resource-attributes';

// Mock Node.js os module with proper Vitest mock functions
vi.mock('node:os', () => ({
  type: vi.fn(),
  platform: vi.fn(),
  arch: vi.fn(),
  totalmem: vi.fn(),
}));

describe('getOsResourceAttributes', () => {
  let mockOs: {
    type: ReturnType<typeof vi.fn>;
    platform: ReturnType<typeof vi.fn>;
    arch: ReturnType<typeof vi.fn>;
    totalmem: ReturnType<typeof vi.fn>;
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
      totalmem: 16777216000,
    };

    mockOs.type.mockReturnValue(mockOsData.type);
    mockOs.platform.mockReturnValue(mockOsData.platform);
    mockOs.arch.mockReturnValue(mockOsData.arch);
    mockOs.totalmem.mockReturnValue(mockOsData.totalmem);

    const result = getOsResourceAttributes();

    expect(result).toEqual({
      'os.type': 'Linux',
      'os.platform': 'linux',
      'os.arch': 'x64',
      'os.totalmem': 16777216000,
    });
  });

  it('should call all required os module functions', () => {
    // Set up mock returns to avoid undefined values
    mockOs.type.mockReturnValue('Linux');
    mockOs.platform.mockReturnValue('linux');
    mockOs.arch.mockReturnValue('x64');
    mockOs.totalmem.mockReturnValue(16777216000);

    getOsResourceAttributes();

    expect(mockOs.type).toHaveBeenCalledOnce();
    expect(mockOs.platform).toHaveBeenCalledOnce();
    expect(mockOs.arch).toHaveBeenCalledOnce();
    expect(mockOs.totalmem).toHaveBeenCalledOnce();
  });

  it('should handle different OS types correctly', () => {
    const testCases = [
      {
        input: {
          type: 'Windows_NT',
          platform: 'win32',
          arch: 'x64',
          totalmem: 8589934592,
        },
        expected: {
          'os.type': 'Windows_NT',
          'os.platform': 'win32',
          'os.arch': 'x64',
          'os.totalmem': 8589934592,
        },
      },
      {
        input: {
          type: 'Darwin',
          platform: 'darwin',
          arch: 'arm64',
          totalmem: 17179869184,
        },
        expected: {
          'os.type': 'Darwin',
          'os.platform': 'darwin',
          'os.arch': 'arm64',
          'os.totalmem': 17179869184,
        },
      },
    ];

    testCases.forEach(({ input, expected }) => {
      mockOs.type.mockReturnValue(input.type);
      mockOs.platform.mockReturnValue(input.platform as NodeJS.Platform);
      mockOs.arch.mockReturnValue(input.arch);
      mockOs.totalmem.mockReturnValue(input.totalmem);

      const result = getOsResourceAttributes();
      expect(result).toEqual(expected);
    });
  });
});
