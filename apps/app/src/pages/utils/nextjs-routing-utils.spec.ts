/**
 * Unit tests for nextjs-routing-utils.ts
 *
 * This test suite covers:
 * - useNextjsRoutingPageRegister hook functionality
 * - detectNextjsRoutingType function with various routing scenarios
 * - Edge cases and error handling
 *
 * @vitest-environment happy-dom
 */

import type { GetServerSidePropsContext } from 'next';
import { renderHook } from '@testing-library/react';
import Cookies from 'js-cookie';
import { mock } from 'vitest-mock-extended';

import {
  detectNextjsRoutingType,
  useNextjsRoutingPageRegister,
} from './nextjs-routing-utils';

// Mock js-cookie
vi.mock('js-cookie', () => ({
  default: {
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockCookies = vi.mocked(Cookies);

describe('nextjs-routing-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useNextjsRoutingPageRegister', () => {
    it('should set cookie when nextjsRoutingPage is provided', () => {
      const testPage = '/test-page';

      renderHook(() => useNextjsRoutingPageRegister(testPage));

      expect(mockCookies.set).toHaveBeenCalledWith(
        'nextjsRoutingPage',
        testPage,
        { path: '/', expires: 1 / 24 },
      );
    });

    it('should remove cookie when nextjsRoutingPage is null', () => {
      renderHook(() => useNextjsRoutingPageRegister(undefined));

      expect(mockCookies.remove).toHaveBeenCalledWith('nextjsRoutingPage');
    });

    it('should update cookie when nextjsRoutingPage changes', () => {
      const { rerender } = renderHook(
        ({ page }) => useNextjsRoutingPageRegister(page),
        { initialProps: { page: '/initial-page' } },
      );

      expect(mockCookies.set).toHaveBeenCalledWith(
        'nextjsRoutingPage',
        '/initial-page',
        { path: '/', expires: 1 / 24 },
      );

      // Clear mock to check next call
      mockCookies.set.mockClear();

      rerender({ page: '/updated-page' });

      expect(mockCookies.set).toHaveBeenCalledWith(
        'nextjsRoutingPage',
        '/updated-page',
        { path: '/', expires: 1 / 24 },
      );
    });

    it('should call useEffect cleanup when component unmounts', () => {
      const testPage = '/test-page';

      const { unmount } = renderHook(() =>
        useNextjsRoutingPageRegister(testPage),
      );

      expect(mockCookies.set).toHaveBeenCalledWith(
        'nextjsRoutingPage',
        testPage,
        { path: '/', expires: 1 / 24 },
      );

      unmount();

      // useEffect cleanup should not cause additional calls
      expect(mockCookies.set).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid prop changes correctly', () => {
      const { rerender } = renderHook(
        ({ page }: { page: string | null }) =>
          useNextjsRoutingPageRegister(page ?? undefined),
        { initialProps: { page: '/page1' as string | null } },
      );

      expect(mockCookies.set).toHaveBeenLastCalledWith(
        'nextjsRoutingPage',
        '/page1',
        { path: '/', expires: 1 / 24 },
      );

      rerender({ page: '/page2' });
      expect(mockCookies.set).toHaveBeenLastCalledWith(
        'nextjsRoutingPage',
        '/page2',
        { path: '/', expires: 1 / 24 },
      );

      rerender({ page: null });
      expect(mockCookies.remove).toHaveBeenLastCalledWith('nextjsRoutingPage');

      rerender({ page: '/page3' });
      expect(mockCookies.set).toHaveBeenLastCalledWith(
        'nextjsRoutingPage',
        '/page3',
        { path: '/', expires: 1 / 24 },
      );
    });
  });

  describe('detectNextjsRoutingType', () => {
    // Type-safe helper function to create mock contexts using vitest-mock-extended
    const createMockContext = (
      hasNextjsHeader: boolean,
      cookieValue?: string,
    ): GetServerSidePropsContext => {
      const mockReq = mock<GetServerSidePropsContext['req']>();
      const mockRes = mock<GetServerSidePropsContext['res']>();

      // Configure mock request headers
      mockReq.headers = hasNextjsHeader ? { 'x-nextjs-data': '1' } : {};

      // Configure mock request cookies
      mockReq.cookies = cookieValue ? { nextjsRoutingPage: cookieValue } : {};

      return {
        req: mockReq,
        res: mockRes,
        query: {},
        params: {},
        resolvedUrl: '/test',
      };
    };

    // Helper function for special edge cases requiring type coercion
    const createMockContextWithSpecialValues = (
      headerValue: string | undefined,
      cookieValue: string | null,
    ): GetServerSidePropsContext => {
      const mockReq = mock<GetServerSidePropsContext['req']>();
      const mockRes = mock<GetServerSidePropsContext['res']>();

      // For edge cases where we need to simulate invalid types that can occur at runtime
      mockReq.headers =
        headerValue !== undefined ? { 'x-nextjs-data': headerValue } : {};
      mockReq.cookies =
        cookieValue !== null
          ? { nextjsRoutingPage: cookieValue as string }
          : {};

      return {
        req: mockReq,
        res: mockRes,
        query: {},
        params: {},
        resolvedUrl: '/test',
      };
    };

    it('should return INITIAL when request is not CSR (no x-nextjs-data header)', () => {
      const context = createMockContext(false);
      const previousRoutingPage = '/previous-page';

      const result = detectNextjsRoutingType(context, previousRoutingPage);

      expect(result).toBe('initial');
    });

    it('should return SAME_ROUTE when CSR and cookie matches previousRoutingPage', () => {
      const previousRoutingPage = '/same-page';
      const context = createMockContext(true, previousRoutingPage);

      const result = detectNextjsRoutingType(context, previousRoutingPage);

      expect(result).toBe('same-route');
    });

    it('should return FROM_OUTSIDE when CSR but no cookie exists', () => {
      const context = createMockContext(true); // No cookie value
      const previousRoutingPage = '/previous-page';

      const result = detectNextjsRoutingType(context, previousRoutingPage);

      expect(result).toBe('from-outside');
    });

    it('should return FROM_OUTSIDE when CSR and cookie does not match previousRoutingPage', () => {
      const context = createMockContext(true, '/different-page');
      const previousRoutingPage = '/previous-page';

      const result = detectNextjsRoutingType(context, previousRoutingPage);

      expect(result).toBe('from-outside');
    });

    it('should return FROM_OUTSIDE when CSR and cookie is empty string', () => {
      const context = createMockContext(true, '');
      const previousRoutingPage = '/previous-page';

      const result = detectNextjsRoutingType(context, previousRoutingPage);

      expect(result).toBe('from-outside');
    });

    it('should handle x-nextjs-data header with different truthy values', () => {
      const context = createMockContext(true, '/test-page');
      // Override the header value to test different truthy values
      const mockReq = context.req as typeof context.req & {
        headers: Record<string, string>;
      };
      mockReq.headers = { 'x-nextjs-data': 'some-value' };

      const result = detectNextjsRoutingType(context, '/test-page');

      expect(result).toBe('same-route');
    });

    it('should handle edge case where cookie value is null but previousRoutingPage exists', () => {
      // Using helper function for edge case where we need to simulate runtime null values
      const context = createMockContextWithSpecialValues('1', null);

      const result = detectNextjsRoutingType(context, '/previous-page');

      expect(result).toBe('from-outside');
    });

    it('should handle missing x-nextjs-data header even when cookies are present', () => {
      const mockReq = mock<GetServerSidePropsContext['req']>();
      const mockRes = mock<GetServerSidePropsContext['res']>();

      mockReq.headers = {}; // No x-nextjs-data header
      mockReq.cookies = { nextjsRoutingPage: '/test-page' };

      const context: GetServerSidePropsContext = {
        req: mockReq,
        res: mockRes,
        query: {},
        params: {},
        resolvedUrl: '/test',
      };

      const result = detectNextjsRoutingType(context, '/test-page');

      expect(result).toBe('initial');
    });

    it('should handle undefined x-nextjs-data header value', () => {
      // Using helper function for edge case where header value is undefined
      const context = createMockContextWithSpecialValues(
        undefined,
        '/test-page',
      );

      const result = detectNextjsRoutingType(context, '/test-page');

      expect(result).toBe('initial');
    });
  });
});
