import type { NextRouter } from 'next/router';
import { useRouter } from 'next/router';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFetchCurrentPage } from '~/states/page';

import { NextjsRoutingType } from '../utils/nextjs-routing-utils';
import { useInitialCSRFetch } from './use-initial-csr-fetch';

// Mock dependencies
vi.mock('next/router', () => ({
  useRouter: vi.fn(),
}));
vi.mock('~/states/page');

// Define stable mock functions outside of describe/beforeEach
const mockFetchCurrentPage = vi.fn();

describe('useInitialCSRFetch', () => {
  let mockRouter: { asPath: string };

  beforeEach(() => {
    vi.clearAllMocks();

    mockRouter = {
      asPath: '/Sandbox',
    };

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue(
      mockRouter as NextRouter,
    );

    (useFetchCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
      fetchCurrentPage: mockFetchCurrentPage,
      isLoading: false,
      error: null,
    });
  });

  describe('when nextjsRoutingType is FROM_OUTSIDE', () => {
    it('should fetch with current path', () => {
      renderHook(() =>
        useInitialCSRFetch({
          nextjsRoutingType: NextjsRoutingType.FROM_OUTSIDE,
          skipSSR: false,
        }),
      );

      expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
      expect(mockFetchCurrentPage).toHaveBeenCalledWith({
        force: true,
        path: '/Sandbox',
      });
    });
  });

  describe('when skipSSR is true', () => {
    it('should fetch with current path for INITIAL routing', () => {
      renderHook(() =>
        useInitialCSRFetch({
          nextjsRoutingType: NextjsRoutingType.INITIAL,
          skipSSR: true,
        }),
      );

      expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
      expect(mockFetchCurrentPage).toHaveBeenCalledWith({
        force: true,
        path: '/Sandbox',
      });
    });
  });

  describe('when nextjsRoutingType is INITIAL and skipSSR is false', () => {
    it('should NOT fetch', () => {
      renderHook(() =>
        useInitialCSRFetch({
          nextjsRoutingType: NextjsRoutingType.INITIAL,
          skipSSR: false,
        }),
      );

      expect(mockFetchCurrentPage).not.toHaveBeenCalled();
    });
  });

  describe('when nextjsRoutingType is SAME_ROUTE', () => {
    it('should NOT fetch', () => {
      renderHook(() =>
        useInitialCSRFetch({
          nextjsRoutingType: NextjsRoutingType.SAME_ROUTE,
          skipSSR: false,
        }),
      );

      expect(mockFetchCurrentPage).not.toHaveBeenCalled();
    });

    it('should fetch when skipSSR is true', () => {
      // skipSSR: true triggers fetch regardless of routing type
      renderHook(() =>
        useInitialCSRFetch({
          nextjsRoutingType: NextjsRoutingType.SAME_ROUTE,
          skipSSR: true,
        }),
      );

      expect(mockFetchCurrentPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('path handling', () => {
    it('should use router.asPath as the fetch path', () => {
      mockRouter.asPath = '/custom/path?query=1';

      renderHook(() =>
        useInitialCSRFetch({
          nextjsRoutingType: NextjsRoutingType.FROM_OUTSIDE,
          skipSSR: false,
        }),
      );

      expect(mockFetchCurrentPage).toHaveBeenCalledWith({
        force: true,
        path: '/custom/path?query=1',
      });
    });
  });
});
