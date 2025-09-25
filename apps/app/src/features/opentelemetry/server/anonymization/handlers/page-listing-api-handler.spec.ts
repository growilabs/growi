import type { IncomingMessage } from 'node:http';

import { beforeEach, describe, expect, it } from 'vitest';

import { pageListingApiModule } from './page-listing-api-handler';

describe('pageListingApiModule', () => {
  const mockRequest = {} as IncomingMessage;

  beforeEach(() => {
    // No mocks needed - test actual behavior
  });

  describe('canHandle', () => {
    it.each`
      description                           | url                                                  | expected
      ${'ancestors-children endpoint'}      | ${'/_api/v3/page-listing/ancestors-children?path=/'} | ${true}
      ${'children endpoint'}                | ${'/_api/v3/page-listing/children?path=/docs'}       | ${true}
      ${'info endpoint'}                    | ${'/_api/v3/page-listing/info?path=/wiki'}           | ${true}
      ${'ancestors-children without query'} | ${'/_api/v3/page-listing/ancestors-children'}        | ${true}
      ${'children without query'}           | ${'/_api/v3/page-listing/children'}                  | ${true}
      ${'info without query'}               | ${'/_api/v3/page-listing/info'}                      | ${true}
      ${'other page-listing endpoint'}      | ${'/_api/v3/page-listing/other'}                     | ${false}
      ${'different API version'}            | ${'/_api/v2/page-listing/children'}                  | ${false}
      ${'non-page-listing API'}             | ${'/_api/v3/pages/list'}                             | ${false}
      ${'regular page path'}                | ${'/page/path'}                                      | ${false}
      ${'root path'}                        | ${'/'}                                               | ${false}
      ${'empty URL'}                        | ${''}                                                | ${false}
      ${'partial match'}                    | ${'/_api/v3/page-listing-other/children'}            | ${false}
    `('should return $expected for $description: $url', ({ url, expected }) => {
      const result = pageListingApiModule.canHandle(url);
      expect(result).toBe(expected);
    });
  });

  describe('handle', () => {
    describe('ancestors-children endpoint', () => {
      it('should anonymize path parameter when present', () => {
        const originalUrl =
          '/_api/v3/page-listing/ancestors-children?path=/sensitive/path&limit=10';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page-listing/ancestors-children?path=%5BANONYMIZED%5D&limit=10',
        });
      });

      it('should anonymize empty path parameter', () => {
        const originalUrl =
          '/_api/v3/page-listing/ancestors-children?path=&limit=5';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        // Empty path parameter should now be anonymized
        expect(result).toEqual({
          'http.target':
            '/_api/v3/page-listing/ancestors-children?path=%5BANONYMIZED%5D&limit=5',
        });
      });

      it('should return null when no path parameter is present', () => {
        const originalUrl = '/_api/v3/page-listing/ancestors-children?limit=10';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toBeNull();
      });
    });

    describe('children endpoint', () => {
      it('should anonymize path parameter when present', () => {
        const originalUrl =
          '/_api/v3/page-listing/children?path=/docs/api&offset=0&limit=20';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page-listing/children?path=%5BANONYMIZED%5D&offset=0&limit=20',
        });
      });

      it('should handle encoded path parameter', () => {
        const originalUrl =
          '/_api/v3/page-listing/children?path=%2Fencoded%2Fpath&limit=10';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page-listing/children?path=%5BANONYMIZED%5D&limit=10',
        });
      });

      it('should return null when no path parameter is present', () => {
        const originalUrl = '/_api/v3/page-listing/children?limit=10';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toBeNull();
      });
    });

    describe('info endpoint', () => {
      it('should anonymize path parameter when present', () => {
        const originalUrl =
          '/_api/v3/page-listing/info?path=/wiki/documentation';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/v3/page-listing/info?path=%5BANONYMIZED%5D',
        });
      });

      it('should return null when no path parameter is present', () => {
        const originalUrl = '/_api/v3/page-listing/info';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle URL with complex query parameters', () => {
        const originalUrl =
          '/_api/v3/page-listing/ancestors-children?path=/complex/path&sort=name&direction=asc&filter=active';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page-listing/ancestors-children?path=%5BANONYMIZED%5D&sort=name&direction=asc&filter=active',
        });
      });

      it('should handle URL with fragment', () => {
        const originalUrl = '/_api/v3/page-listing/children?path=/docs#section';

        // Ensure canHandle returns true for this URL
        expect(pageListingApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageListingApiModule.handle(mockRequest, originalUrl);

        // Fragment should be preserved by anonymizeQueryParams
        expect(result).toEqual({
          'http.target':
            '/_api/v3/page-listing/children?path=%5BANONYMIZED%5D#section',
        });
      });
    });
  });
});
