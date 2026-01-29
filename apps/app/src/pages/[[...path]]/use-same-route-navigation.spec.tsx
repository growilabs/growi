import type { NextRouter } from 'next/router';
import { useRouter } from 'next/router';
import type { IPagePopulatedToShowRevision } from '@growi/core';
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { useFetchCurrentPage } from '~/states/page';
import { useSetEditingMarkdown } from '~/states/ui/editor';

import { useSameRouteNavigation } from './use-same-route-navigation';

// Mock dependencies
vi.mock('next/router', () => ({
  useRouter: vi.fn(),
}));
vi.mock('~/states/page');
vi.mock('~/states/ui/editor');

// Define stable mock functions outside of describe/beforeEach
const mockFetchCurrentPage = vi.fn();
const mockSetEditingMarkdown = vi.fn();

const pageDataMock = mock<IPagePopulatedToShowRevision>({
  revision: {
    body: 'Test page content',
  },
});

describe('useSameRouteNavigation', () => {
  // Define a mutable router object that can be accessed and modified in tests
  let mockRouter: { asPath: string };

  beforeEach(() => {
    // Clear mocks and reset implementations before each test
    vi.clearAllMocks();

    // Initialize the mutable router object
    mockRouter = {
      asPath: '',
    };

    // Mock useRouter to return our mutable router object
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
      mockRouter as NextRouter,
    );

    (useFetchCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchCurrentPage: mockFetchCurrentPage,
    });

    (useSetEditingMarkdown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockSetEditingMarkdown,
    );

    mockFetchCurrentPage.mockResolvedValue(pageDataMock);
  });

  it('should call fetchCurrentPage and mutateEditingMarkdown on path change', async () => {
    // Arrange: Initial render (SSR case - no fetch on initial render)
    mockRouter.asPath = '/initial-path';
    const { rerender } = renderHook(() => useSameRouteNavigation());

    // Assert: No fetch on initial render (useRef previousPath is null)
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
    expect(mockSetEditingMarkdown).not.toHaveBeenCalled();

    // Act: Simulate CSR navigation to a new path
    mockRouter.asPath = '/new-path';
    rerender();

    // Assert
    await waitFor(() => {
      // 1. fetchCurrentPage is called with the new path
      expect(mockFetchCurrentPage).toHaveBeenCalledWith({ path: '/new-path' });

      // 2. mutateEditingMarkdown is called with the content from the fetched page
      expect(mockSetEditingMarkdown).toHaveBeenCalledWith(
        pageDataMock.revision?.body,
      );
    });
  });

  it('should not trigger effects if the path does not change', async () => {
    // Arrange: Initial render
    mockRouter.asPath = '/same-path';
    const { rerender } = renderHook(() => useSameRouteNavigation());

    // Initial render should not trigger fetch (previousPath is null initially)
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
    expect(mockSetEditingMarkdown).not.toHaveBeenCalled();

    // Act: Rerender with the same path (simulates a non-navigation re-render)
    rerender();

    // Assert: Still no fetch because path hasn't changed
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();
    expect(mockSetEditingMarkdown).not.toHaveBeenCalled();
  });

  it('should not call mutateEditingMarkdown if pageData or revision is null', async () => {
    // Arrange: Initial render
    mockRouter.asPath = '/initial-path';
    const { rerender } = renderHook(() => useSameRouteNavigation());

    // Initial render should not trigger fetch
    expect(mockFetchCurrentPage).not.toHaveBeenCalled();

    // Arrange: Mock fetch to return null for the next navigation
    mockFetchCurrentPage.mockResolvedValue(null);

    // Act: Navigate to a new path
    mockRouter.asPath = '/path-with-no-data';
    rerender();

    // Assert
    await waitFor(() => {
      // fetch should be called
      expect(mockFetchCurrentPage).toHaveBeenCalledWith({
        path: '/path-with-no-data',
      });
      // but mutate should not be called because pageData is null
      expect(mockSetEditingMarkdown).not.toHaveBeenCalled();
    });
  });
});
