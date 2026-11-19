import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock configManager before importing the module under test
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Mock logger to suppress output in tests
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { configManager } from '~/server/service/config-manager';

import { createRequireSearchAttachmentsEnabled } from './require-search-attachments-enabled';

describe('createRequireSearchAttachmentsEnabled', () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;
  let isSearchServiceConfigured: ReturnType<typeof vi.fn>;
  let mockGetConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    req = {} as Request;
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    next = vi.fn() as unknown as NextFunction;
    isSearchServiceConfigured = vi.fn();
    mockGetConfig = vi.mocked(configManager.getConfig);
    mockGetConfig.mockReset();
  });

  describe('when feature is disabled', () => {
    it('returns 503 with feature_disabled when isSearchServiceConfigured returns false', () => {
      isSearchServiceConfigured.mockReturnValue(false);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'valid-token';
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when extractorUri is null', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri') return null;
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'valid-token';
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when extractorUri is undefined', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return undefined;
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'valid-token';
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when extractorUri is empty string', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri') return '';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'valid-token';
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when extractorToken is null', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken') return null;
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when extractorToken is undefined', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return undefined;
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when extractorToken is empty string', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken') return '';
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('when feature is enabled', () => {
    it('calls next() when all conditions are satisfied', () => {
      isSearchServiceConfigured.mockReturnValue(true);
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'valid-token';
        return undefined;
      });

      const middleware = createRequireSearchAttachmentsEnabled(
        isSearchServiceConfigured,
      );
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
