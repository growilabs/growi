import type { NextRouter } from 'next/router';
import { useRouter } from 'next/router';
import type {
  IPagePopulatedToShowRevision,
  IRevisionHasId,
  IUserHasId,
  Lang,
  PageGrant,
  PageStatus,
} from '@growi/core';
import { renderHook, waitFor } from '@testing-library/react';
// biome-ignore lint/style/noRestrictedImports: import only types
import type { AxiosResponse } from 'axios';
import { createStore, Provider } from 'jotai';
import { vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';
import { useFetchCurrentPage } from '~/states/page';
import {
  currentPageDataAtom,
  currentPageIdAtom,
  isForbiddenAtom,
  pageErrorAtom,
  pageLoadingAtom,
  pageNotFoundAtom,
  remoteRevisionBodyAtom,
  remoteRevisionIdAtom,
} from '~/states/page/internal-atoms';

// Mock Next.js router
const mockRouter = mockDeep<NextRouter>();
vi.mock('next/router', () => ({
  useRouter: vi.fn(() => mockRouter),
}));

// Mock API client
vi.mock('~/client/util/apiv3-client');
const mockedApiv3Get = vi.spyOn(apiv3Client, 'apiv3Get');

const mockUser: IUserHasId = {
  _id: 'user1',
  name: 'Test User',
  username: 'testuser',
  email: 'test@example.com',
  password: 'password',
  introduction: '',
  lang: 'en-US' as Lang,
  status: 1,
  admin: false,
  readOnly: false,
  isInvitationEmailSended: false,
  isEmailPublished: false,
  createdAt: new Date(),
  imageUrlCached: '',
  isGravatarEnabled: false,
};

// This is a minimal mock to satisfy the IPagePopulatedToShowRevision type.
// It is based on the type definition in packages/core/src/interfaces/page.ts
const createPageDataMock = (
  pageId: string,
  path: string,
  body: string,
): IPagePopulatedToShowRevision => {
  const revision: IRevisionHasId = {
    _id: `rev_${pageId}`,
    pageId,
    body,
    format: 'markdown',
    author: mockUser,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    _id: pageId,
    path,
    revision,
    tags: [],
    creator: mockUser,
    lastUpdateUser: mockUser,
    deleteUser: mockUser,
    author: mockUser,
    grant: 1 as PageGrant,
    grantedUsers: [],
    grantedGroups: [],
    parent: null,
    descendantCount: 0,
    isEmpty: false,
    status: 'published' as PageStatus,
    wip: false,
    commentCount: 0,
    seenUsers: [],
    liker: [],
    expandContentWidth: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    slackChannels: '',
    deletedAt: new Date(),
  };
};

describe('useFetchCurrentPage - Integration Test', () => {
  let store: ReturnType<typeof createStore>;

  // Helper to render the hook with Jotai provider
  const renderHookWithProvider = () => {
    return renderHook(() => useFetchCurrentPage(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
  };

  const mockApiResponse = (
    page: IPagePopulatedToShowRevision,
  ): AxiosResponse<{ page: IPagePopulatedToShowRevision }> => {
    return {
      data: { page },
      status: 200,
      statusText: 'OK',
      headers: {},
      // Cast to satisfy AxiosResponse without resorting to explicit any
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      config: {} as AxiosResponse['config'],
    };
  };

  beforeEach(() => {
    store = createStore();
    vi.clearAllMocks();

    // Base router setup
    mockRouter.asPath = '/initial/path';
    mockRouter.pathname = '/[[...path]]';
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(mockRouter);

    // Default API response
    const defaultPageData = createPageDataMock(
      'defaultPageId',
      '/initial/path',
      'default content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(defaultPageData));
  });

  it('should fetch data and update atoms when called with a new path', async () => {
    // Arrange: Start at an initial page
    const initialPageData = createPageDataMock(
      'initialPageId',
      '/initial/path',
      'initial content',
    );
    store.set(currentPageIdAtom, initialPageData._id);
    store.set(currentPageDataAtom, initialPageData);

    // Arrange: Navigate to a new page
    const newPageData = createPageDataMock(
      'newPageId',
      '/new/page',
      'new content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(newPageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/new/page' });

    // Assert: Wait for state updates
    await waitFor(() => {
      // 1. API was called correctly
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ path: '/new/page' }),
      );

      // 2. Atoms were updated
      expect(store.get(currentPageIdAtom)).toBe(newPageData._id);
      expect(store.get(currentPageDataAtom)).toEqual(newPageData);
      expect(store.get(pageLoadingAtom)).toBe(false);
      expect(store.get(pageNotFoundAtom)).toBe(false);
      expect(store.get(pageErrorAtom)).toBeNull();
    });
  });

  it('should not re-fetch if target path is the same as current', async () => {
    // Arrange: Current state is set
    const currentPageData = createPageDataMock(
      'page1',
      '/same/path',
      'current content',
    );
    store.set(currentPageIdAtom, currentPageData._id);
    store.set(currentPageDataAtom, currentPageData);

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/same/path' });

    // Assert
    // Use a short timeout to ensure no fetch is initiated
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockedApiv3Get).not.toHaveBeenCalled();
  });

  it('should handle fetching the root page', async () => {
    // Arrange: Start on a regular page
    const regularPageData = createPageDataMock(
      'regularPageId',
      '/some/page',
      'Regular page content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(regularPageData));

    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/some/page' });

    await waitFor(() => {
      expect(store.get(currentPageIdAtom)).toBe('regularPageId');
    });

    // Arrange: Navigate to the root page
    mockedApiv3Get.mockClear();
    const rootPageData = createPageDataMock(
      'rootPageId',
      '/',
      'Root page content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(rootPageData));

    // Act
    await result.current.fetchCurrentPage({ path: '/' });

    // Assert: Navigation to root works
    await waitFor(() => {
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ path: '/' }),
      );
      expect(store.get(currentPageIdAtom)).toBe('rootPageId');
    });
  });

  it('should handle encoded URI path', async () => {
    // Arrange
    const encodedPath = '/encoded%2Fpath'; // /encoded/path
    const decodedPath = decodeURIComponent(encodedPath);
    const newPageData = createPageDataMock(
      'encodedPageId',
      decodedPath,
      'encoded content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(newPageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: encodedPath });

    // Assert
    await waitFor(() => {
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ path: decodedPath }),
      );
      expect(store.get(currentPageIdAtom)).toBe('encodedPageId');
    });
  });

  it('should handle permalink path', async () => {
    // Arrange
    const permalink = '/65d4e0a0f7b7b2e5a8652e86';
    const newPageData = createPageDataMock(
      '65d4e0a0f7b7b2e5a8652e86',
      '/any/path',
      'permalink content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(newPageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: permalink });

    // Assert
    await waitFor(() => {
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ pageId: '65d4e0a0f7b7b2e5a8652e86' }),
      );
      expect(store.get(currentPageIdAtom)).toBe('65d4e0a0f7b7b2e5a8652e86');
    });
  });

  it('should handle path with permalink and convert to pageId for API call', async () => {
    // Arrange: A path that looks like a permalink
    const permalinkPath = '/58a4569921a8424d00a1aa0e';
    const expectedPageId = '58a4569921a8424d00a1aa0e';
    const pageData = createPageDataMock(
      expectedPageId,
      '/actual/page/path',
      'permalink content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(pageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: permalinkPath });

    // Assert
    await waitFor(() => {
      // 1. API should be called with pageId instead of path
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ pageId: expectedPageId }),
      );
      // 2. API should NOT be called with path
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.not.objectContaining({ path: expect.anything() }),
      );

      // 3. State should be updated correctly
      expect(store.get(currentPageIdAtom)).toBe(expectedPageId);
      expect(store.get(currentPageDataAtom)).toEqual(pageData);
      expect(store.get(pageLoadingAtom)).toBe(false);
      expect(store.get(pageNotFoundAtom)).toBe(false);
      expect(store.get(pageErrorAtom)).toBeNull();
    });
  });

  it('should prioritize explicit pageId over permalink path', async () => {
    // Arrange: Both pageId and permalink path are provided, pageId should take priority
    const explicitPageId = 'explicit123456789012345678901234';
    const permalinkPath = '/58a4569921a8424d00a1aa0e';
    const pageData = createPageDataMock(
      explicitPageId,
      '/prioritized/page',
      'explicit pageId content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(pageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({
      path: permalinkPath,
      pageId: explicitPageId,
    });

    // Assert
    await waitFor(() => {
      // 1. API should be called with explicit pageId, not the permalink from path
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ pageId: explicitPageId }),
      );
      // 2. Should NOT use the permalink ID from path
      expect(mockedApiv3Get).not.toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ pageId: '58a4569921a8424d00a1aa0e' }),
      );

      // 3. State should be updated with explicit pageId
      expect(store.get(currentPageIdAtom)).toBe(explicitPageId);
      expect(store.get(currentPageDataAtom)).toEqual(pageData);
    });
  });

  it('should handle regular path (non-permalink) correctly', async () => {
    // Arrange: Regular path that is NOT a permalink
    const regularPath = '/regular/page/path';
    const pageData = createPageDataMock(
      'regularPageId123',
      regularPath,
      'regular page content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(pageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: regularPath });

    // Assert
    await waitFor(() => {
      // 1. API should be called with path, not pageId
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ path: regularPath }),
      );
      // 2. API should NOT be called with pageId
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.not.objectContaining({ pageId: expect.anything() }),
      );

      // 3. State should be updated correctly
      expect(store.get(currentPageIdAtom)).toBe('regularPageId123');
      expect(store.get(currentPageDataAtom)).toEqual(pageData);
    });
  });

  it('should handle permalink path with hash fragment and strip hash for API call', async () => {
    // Arrange: Permalink path with hash fragment like #edit
    const permalinkWithHash = '/58a4569921a8424d00a1aa0e#edit';
    const expectedPageId = '58a4569921a8424d00a1aa0e';
    const pageData = createPageDataMock(
      expectedPageId,
      '/actual/page/path',
      'permalink with hash content',
    );
    mockedApiv3Get.mockResolvedValue(mockApiResponse(pageData));

    // Act
    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: permalinkWithHash });

    // Assert
    await waitFor(() => {
      // 1. API should be called with pageId (hash stripped), not with path
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.objectContaining({ pageId: expectedPageId }),
      );
      // 2. API should NOT be called with path containing hash
      expect(mockedApiv3Get).toHaveBeenCalledWith(
        '/page',
        expect.not.objectContaining({ path: expect.anything() }),
      );

      // 3. State should be updated correctly
      expect(store.get(currentPageIdAtom)).toBe(expectedPageId);
      expect(store.get(currentPageDataAtom)).toEqual(pageData);
      expect(store.get(pageLoadingAtom)).toBe(false);
      expect(store.get(pageNotFoundAtom)).toBe(false);
      expect(store.get(pageErrorAtom)).toBeNull();
    });
  });

  it('should handle various hash fragments with permalink', async () => {
    // Test various hash patterns that commonly occur
    const testCases = [
      {
        input: '/58a4569921a8424d00a1aa0e#edit',
        expectedPageId: '58a4569921a8424d00a1aa0e',
        description: 'edit hash',
      },
      {
        input: '/58a4569921a8424d00a1aa0e#section-header',
        expectedPageId: '58a4569921a8424d00a1aa0e',
        description: 'section hash',
      },
      {
        input: '/58a4569921a8424d00a1aa0e#',
        expectedPageId: '58a4569921a8424d00a1aa0e',
        description: 'empty hash',
      },
    ];

    for (const testCase of testCases) {
      // Clean up for each iteration - ensure fresh state
      vi.clearAllMocks();
      store = createStore();

      // Arrange
      const pageData = createPageDataMock(
        testCase.expectedPageId,
        '/any/path',
        `content for ${testCase.description}`,
      );
      mockedApiv3Get.mockResolvedValue(mockApiResponse(pageData));

      // Act
      const { result } = renderHookWithProvider();
      await result.current.fetchCurrentPage({ path: testCase.input });

      // Assert
      await waitFor(() => {
        expect(mockedApiv3Get).toHaveBeenCalledWith(
          '/page',
          expect.objectContaining({ pageId: testCase.expectedPageId }),
        );
        expect(store.get(currentPageIdAtom)).toBe(testCase.expectedPageId);
      });
    }
  });

  it('should handle not found error (ErrorV3 with IPageNotFoundInfo args) in catch block', async () => {
    // Arrange: set initial page and remote revision atoms so we can verify they are cleared
    const existingPage = createPageDataMock(
      'someExistingId',
      '/some/existing',
      'existing body',
    );
    store.set(currentPageIdAtom, existingPage._id);
    store.set(currentPageDataAtom, existingPage);
    store.set(remoteRevisionIdAtom, 'rev_xxx');
    store.set(remoteRevisionBodyAtom, 'remote body');

    // Mock API rejection with ErrorV3 like object
    const notFoundError = {
      code: 'not_found',
      message: 'Page not found',
      args: { isNotFound: true, isForbidden: true },
    } as const; // shape satisfying isErrorV3 predicate
    mockedApiv3Get.mockRejectedValueOnce([notFoundError]);

    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/will/not/found' });

    // Assert
    await waitFor(() => {
      expect(store.get(pageLoadingAtom)).toBe(false);
      expect(store.get(pageNotFoundAtom)).toBe(true);
      expect(store.get(isForbiddenAtom)).toBe(true);
      expect(store.get(pageErrorAtom)).toMatchObject({
        message: 'Page not found',
      });
      expect(store.get(currentPageDataAtom)).toBeUndefined();
      expect(store.get(currentPageIdAtom)).toBeUndefined();
      expect(store.get(remoteRevisionIdAtom)).toBeUndefined();
      expect(store.get(remoteRevisionBodyAtom)).toBeUndefined();
    });
  });

  it('should handle unknown error shape by setting generic error', async () => {
    // Arrange: ensure atoms start clean
    vi.clearAllMocks();
    const unknownError = new Error('network down');
    // The code checks first for an array; pass non-array to trigger generic branch
    mockedApiv3Get.mockRejectedValueOnce(unknownError);

    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/any/path' });

    await waitFor(() => {
      const err = store.get(pageErrorAtom);
      expect(err).not.toBeNull();
      expect(err?.message).toBe('Unknown error');
      expect(store.get(pageLoadingAtom)).toBe(false);
      // pageNotFoundAtom should NOT be set to true for unknown errors
      expect(store.get(pageNotFoundAtom)).toBe(false);
    });
  });

  it('should handle empty error array by setting generic error', async () => {
    // Arrange: ensure atoms start clean
    vi.clearAllMocks();
    // The code checks for array length; pass empty array to trigger generic branch
    mockedApiv3Get.mockRejectedValueOnce([]);

    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/any/path' });

    await waitFor(() => {
      const err = store.get(pageErrorAtom);
      expect(err).not.toBeNull();
      expect(err?.message).toBe('Unknown error');
      expect(store.get(pageLoadingAtom)).toBe(false);
      // pageNotFoundAtom should NOT be set to true for empty error arrays
      expect(store.get(pageNotFoundAtom)).toBe(false);
    });
  });

  it('should handle non-ErrorV3 error in array by not processing as page not found', async () => {
    // Arrange: ensure atoms start clean
    vi.clearAllMocks();
    // Pass array with non-ErrorV3 object (missing code/message properties)
    const nonErrorV3 = {
      someOtherProperty: 'value',
      args: { isNotFound: true, isForbidden: true },
    };
    mockedApiv3Get.mockRejectedValueOnce([nonErrorV3]);

    const { result } = renderHookWithProvider();
    await result.current.fetchCurrentPage({ path: '/any/path' });

    await waitFor(() => {
      expect(store.get(pageLoadingAtom)).toBe(false);
      // Since isErrorV3 returns false, pageErrorAtom should NOT be set
      expect(store.get(pageErrorAtom)).toBeNull();
      // pageNotFoundAtom should NOT be set to true for non-ErrorV3 errors
      expect(store.get(pageNotFoundAtom)).toBe(false);
      // isForbiddenAtom should remain at default state
      expect(store.get(isForbiddenAtom)).toBe(false);
    });
  });
});
