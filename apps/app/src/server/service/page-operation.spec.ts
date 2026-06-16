import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

// Mock PageOperation model before importing PageOperationService
vi.mock('~/server/models/page-operation', () => {
  const mockModel = {
    extendExpiryDate: vi.fn(),
    deleteByActionTypes: vi.fn(),
    deleteMany: vi.fn(),
    find: vi.fn(),
  };
  return {
    default: mockModel,
  };
});

// Mock loggerFactory
vi.mock('~/utils/logger', () => {
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: vi.fn().mockReturnValue(mockLogger),
  };
});

// Mock Crowi and other dependencies
vi.mock('@growi/core/dist/utils', () => ({
  pagePathUtils: {
    isEitherOfPathAreaOverlap: vi.fn(),
    isPathAreaOverlap: vi.fn(),
    isTrashPage: vi.fn(),
  },
}));

vi.mock('~/server/util/collect-ancestor-paths', () => ({
  collectAncestorPaths: vi.fn().mockReturnValue([]),
}));

vi.mock('mongoose', () => ({
  default: {
    model: vi.fn(),
  },
}));

import PageOperation from '~/server/models/page-operation';
import loggerFactory from '~/utils/logger';

// We need to import the factory function - the default export is an instanciate() function
// But PageOperationService is not exported directly, so we construct via instanciate
// Actually the class methods are what we test - let's access autoUpdateExpiryDate via instanciate

// Import the instanciate default and use it to create an instance
let instanciate: (crowi: unknown) => {
  autoUpdateExpiryDate: (operationId: unknown) => NodeJS.Timeout;
};

describe('PageOperationService.autoUpdateExpiryDate', () => {
  let mockLogger: { error: MockInstance; warn: MockInstance };
  let service: {
    autoUpdateExpiryDate: (operationId: unknown) => NodeJS.Timeout;
  };
  const operationId = 'test-operation-id-123';

  beforeEach(async () => {
    vi.useFakeTimers();

    // Get mock logger
    mockLogger = (
      loggerFactory as unknown as () => {
        error: MockInstance;
        warn: MockInstance;
      }
    )();

    // Reset mocks
    vi.mocked(PageOperation.extendExpiryDate).mockReset();
    mockLogger.error.mockClear?.();

    // Import service dynamically to ensure mocks are applied
    const module = await import('./page-operation');
    instanciate = module.default as typeof instanciate;

    const mockCrowi = {
      pageService: {
        resumeRenameSubOperation: vi.fn(),
      },
    };
    service = instanciate(mockCrowi);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('when extendExpiryDate resolves successfully', () => {
    it('should not call logger.error', async () => {
      vi.mocked(PageOperation.extendExpiryDate).mockResolvedValue(undefined);

      const timer = service.autoUpdateExpiryDate(operationId);

      // Advance timer to trigger the interval
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockLogger.error).not.toHaveBeenCalled();

      clearInterval(timer);
    });

    it('should continue the interval after a successful tick', async () => {
      vi.mocked(PageOperation.extendExpiryDate).mockResolvedValue(undefined);

      const timer = service.autoUpdateExpiryDate(operationId);

      // Advance timer twice to trigger interval twice
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(vi.mocked(PageOperation.extendExpiryDate)).toHaveBeenCalledTimes(
        2,
      );

      clearInterval(timer);
    });
  });

  describe('when extendExpiryDate rejects', () => {
    it('should call logger.error with err and operationId', async () => {
      const testError = new Error('DB connection failed');
      vi.mocked(PageOperation.extendExpiryDate).mockRejectedValue(testError);

      const timer = service.autoUpdateExpiryDate(operationId);

      // Advance timer to trigger the interval
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: testError, operationId },
        'extendExpiryDate failed',
      );

      clearInterval(timer);
    });

    it('should NOT stop the interval after an error (interval continues)', async () => {
      const testError = new Error('Transient error');
      vi.mocked(PageOperation.extendExpiryDate).mockRejectedValue(testError);

      const timer = service.autoUpdateExpiryDate(operationId);

      // Advance timer to trigger interval three times
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      // extendExpiryDate should have been called 3 times (interval continues)
      expect(vi.mocked(PageOperation.extendExpiryDate)).toHaveBeenCalledTimes(
        3,
      );
      // logger.error should have been called 3 times
      expect(mockLogger.error).toHaveBeenCalledTimes(3);

      clearInterval(timer);
    });

    it('should continue interval after error then succeed on next tick', async () => {
      const testError = new Error('Transient error');
      vi.mocked(PageOperation.extendExpiryDate)
        .mockRejectedValueOnce(testError)
        .mockResolvedValue(undefined);

      const timer = service.autoUpdateExpiryDate(operationId);

      // First tick - fails
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: testError, operationId },
        'extendExpiryDate failed',
      );

      // Second tick - succeeds (interval continued)
      await vi.advanceTimersByTimeAsync(5000);

      expect(vi.mocked(PageOperation.extendExpiryDate)).toHaveBeenCalledTimes(
        2,
      );
      // logger.error not called again
      expect(mockLogger.error).toHaveBeenCalledTimes(1);

      clearInterval(timer);
    });
  });
});
