import type {
  IDataWithMeta,
  IPageInfoExt,
  IPageNotFoundInfo,
} from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageDocument } from '~/server/models/page';

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

interface MockRes {
  apiv3: ReturnType<typeof vi.fn>;
  apiv3Err: ReturnType<typeof vi.fn>;
}

interface MockPage {
  path: string;
  initLatestRevisionField: ReturnType<typeof vi.fn>;
  populateDataToShowRevision: ReturnType<typeof vi.fn>;
}

describe('respondWithSinglePage', () => {
  let mockRes: MockRes;
  let mockPage: MockPage;

  beforeEach(() => {
    mockRes = {
      apiv3: vi.fn().mockReturnValue(undefined),
      apiv3Err: vi.fn().mockReturnValue(undefined),
    };

    mockPage = {
      path: '/normal-page',
      _id: '123',
      initLatestRevisionField: vi.fn(),
      populateDataToShowRevision: vi.fn(),
    };

    // Make populateDataToShowRevision return the same object (modified in place)
    mockPage.populateDataToShowRevision.mockImplementation(() =>
      Promise.resolve(mockPage),
    );
  });

  describe('success case', () => {
    it('should return success response with page and meta when page exists', async () => {
      // Arrange
      const mockMeta = { isNotFound: false } as IPageInfoExt;
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: mockPage as HydratedDocument<PageDocument>,
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
      const mockMeta = { isNotFound: false } as IPageInfoExt;
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: mockPage as HydratedDocument<PageDocument>,
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
      const mockMeta = {
        isNotFound: true,
        isForbidden: true,
      } as IPageNotFoundInfo;
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
      const userPageMock = {
        path: '/user/john',
        initLatestRevisionField: vi.fn(),
        populateDataToShowRevision: vi.fn(),
      };
      const mockMeta = { isNotFound: false } as IPageInfoExt;
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: userPageMock as HydratedDocument<PageDocument>,
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
      const userTopPageMock = {
        path: '/user',
        initLatestRevisionField: vi.fn(),
        populateDataToShowRevision: vi.fn(),
      };
      const mockMeta = { isNotFound: false } as IPageInfoExt;
      const pageWithMeta: IDataWithMeta<
        HydratedDocument<PageDocument>,
        IPageInfoExt
      > = {
        data: userTopPageMock as HydratedDocument<PageDocument>,
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
      const mockMeta = {
        isNotFound: true,
        isForbidden: false,
      } as IPageNotFoundInfo;
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
