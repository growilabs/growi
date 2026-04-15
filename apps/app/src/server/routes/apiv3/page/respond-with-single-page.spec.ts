import type {
  IDataWithMeta,
  IPageInfo,
  IPageInfoExt,
  IPageNotFoundInfo,
} from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageDocument } from '~/server/models/page';

import type { ApiV3Response } from '../interfaces/apiv3-response';

// Mock logger to avoid path resolution issues in tests
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { respondWithSinglePage } from './respond-with-single-page';

// Express Response has extensive required properties that aren't used in these tests
function createMockRes(): ApiV3Response {
  return {
    apiv3: vi.fn().mockReturnValue(undefined),
    apiv3Err: vi.fn().mockReturnValue(undefined),
  } as unknown as ApiV3Response;
}

// HydratedDocument adds Mongoose internals that aren't relevant to these tests
function createMockPage(path = '/normal-page'): HydratedDocument<PageDocument> {
  const page = {
    path,
    initLatestRevisionField: vi.fn(),
    populateDataToShowRevision: vi.fn(),
  };
  page.populateDataToShowRevision.mockResolvedValue(page);
  return page as unknown as HydratedDocument<PageDocument>;
}

function createPageInfo(overrides: Partial<IPageInfo> = {}): IPageInfo {
  return {
    isNotFound: false,
    isV5Compatible: true,
    isEmpty: false,
    isMovable: true,
    isDeletable: true,
    isAbleToDeleteCompletely: true,
    isRevertible: false,
    bookmarkCount: 0,
    ...overrides,
  };
}

describe('respondWithSinglePage', () => {
  let mockRes: ApiV3Response;
  let mockPage: HydratedDocument<PageDocument>;

  beforeEach(() => {
    mockRes = createMockRes();
    mockPage = createMockPage();
  });

  describe('success case', () => {
    it('should return success response with page and meta when page exists', async () => {
      // Arrange
      const mockMeta = createPageInfo();
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: mockPage,
        meta: mockMeta,
      };

      // Act
      await respondWithSinglePage(mockRes, pageWithMeta);

      // Assert
      expect(mockRes.apiv3).toHaveBeenCalledWith(
        expect.objectContaining({
          page: mockPage,
          pages: undefined,
          meta: mockMeta,
        }),
      );
      expect(mockPage.initLatestRevisionField).toHaveBeenCalledWith(undefined);
      expect(mockPage.populateDataToShowRevision).toHaveBeenCalled();
    });

    it('should initialize revision field when revisionId is provided', async () => {
      // Arrange
      const revisionId = '507f1f77bcf86cd799439011';
      const mockMeta = createPageInfo();
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: mockPage,
        meta: mockMeta,
      };

      // Act
      await respondWithSinglePage(mockRes, pageWithMeta, { revisionId });

      // Assert
      expect(mockPage.initLatestRevisionField).toHaveBeenCalledWith(revisionId);
    });
  });

  describe('forbidden case', () => {
    it('should return 403 when page meta has isForbidden=true', async () => {
      // Arrange
      const mockMeta: IPageNotFoundInfo = {
        isNotFound: true,
        isForbidden: true,
      };
      const pageWithMeta: IDataWithMeta<null, IPageNotFoundInfo> = {
        data: null,
        meta: mockMeta,
      };

      // Act
      await respondWithSinglePage(mockRes, pageWithMeta);

      // Assert
      expect(mockRes.apiv3Err).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Page is forbidden',
          code: 'page-is-forbidden',
        }),
        403,
      );
      expect(mockRes.apiv3).not.toHaveBeenCalled();
    });

    it('should return 403 when disableUserPages=true and page is a user page', async () => {
      // Arrange
      const userPage = createMockPage('/user/john');
      const mockMeta = createPageInfo();
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: userPage,
        meta: mockMeta,
      };

      // Act
      await respondWithSinglePage(mockRes, pageWithMeta, {
        disableUserPages: true,
      });

      // Assert
      expect(mockRes.apiv3Err).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Page is forbidden',
          code: 'page-is-forbidden',
        }),
        403,
      );
      expect(mockRes.apiv3).not.toHaveBeenCalled();
    });

    it('should return 403 when disableUserPages=true and page is a user top page', async () => {
      // Arrange
      const userTopPage = createMockPage('/user');
      const mockMeta = createPageInfo();
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: userTopPage,
        meta: mockMeta,
      };

      // Act
      await respondWithSinglePage(mockRes, pageWithMeta, {
        disableUserPages: true,
      });

      // Assert
      expect(mockRes.apiv3Err).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Page is forbidden',
          code: 'page-is-forbidden',
        }),
        403,
      );
    });
  });

  describe('not-found case', () => {
    it('should return 404 when page meta has isForbidden=false (not-found only)', async () => {
      // Arrange
      const mockMeta: IPageNotFoundInfo = {
        isNotFound: true,
        isForbidden: false,
      };
      const pageWithMeta: IDataWithMeta<null, IPageNotFoundInfo> = {
        data: null,
        meta: mockMeta,
      };

      // Act
      await respondWithSinglePage(mockRes, pageWithMeta);

      // Assert
      expect(mockRes.apiv3Err).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Page is not found',
          code: 'page-not-found',
        }),
        404,
      );
    });
  });
});
