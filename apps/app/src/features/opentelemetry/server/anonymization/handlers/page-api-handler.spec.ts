import type { IncomingMessage } from 'node:http';

import { beforeEach, describe, expect, it } from 'vitest';

import { pageApiModule } from './page-api-handler';

describe('pageApiModule', () => {
  const mockRequest = {} as IncomingMessage;

  beforeEach(() => {
    // No mocks needed - test actual behavior
  });

  describe('canHandle', () => {
    it.each`
      description                                        | url                                                              | expected
      ${'pages list endpoint'}                           | ${'/_api/v3/pages/list?path=/home'}                              | ${true}
      ${'subordinated list endpoint'}                    | ${'/_api/v3/pages/subordinated-list?path=/docs'}                 | ${true}
      ${'check page existence endpoint'}                 | ${'/_api/v3/page/check-page-existence?path=/wiki'}               | ${true}
      ${'get page paths with descendant count endpoint'} | ${'/_api/v3/page/get-page-paths-with-descendant-count?paths=[]'} | ${true}
      ${'pages list without query'}                      | ${'/_api/v3/pages/list'}                                         | ${true}
      ${'subordinated list without query'}               | ${'/_api/v3/pages/subordinated-list'}                            | ${true}
      ${'check page existence without query'}            | ${'/_api/v3/page/check-page-existence'}                          | ${true}
      ${'get page paths without query'}                  | ${'/_api/v3/page/get-page-paths-with-descendant-count'}          | ${true}
      ${'other pages endpoint'}                          | ${'/_api/v3/pages/create'}                                       | ${false}
      ${'different API version'}                         | ${'/_api/v2/pages/list'}                                         | ${false}
      ${'non-page API'}                                  | ${'/_api/v3/search'}                                             | ${false}
      ${'regular page path'}                             | ${'/page/path'}                                                  | ${false}
      ${'root path'}                                     | ${'/'}                                                           | ${false}
      ${'empty URL'}                                     | ${''}                                                            | ${false}
      ${'partial match but different endpoint'}          | ${'/_api/v3/pages-other/list'}                                   | ${false}
    `('should return $expected for $description: $url', ({ url, expected }) => {
      const result = pageApiModule.canHandle(url);
      expect(result).toBe(expected);
    });
  });

  describe('handle', () => {
    describe('pages/list endpoint', () => {
      it('should anonymize path parameter when present', () => {
        const originalUrl = '/_api/v3/pages/list?path=/sensitive/path&limit=10';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/v3/pages/list?path=%5BANONYMIZED%5D&limit=10',
        });
      });

      it('should return null when no path parameter is present', () => {
        const url = '/_api/v3/pages/list?limit=10&sort=updated';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(url)).toBe(true);

        const result = pageApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });
    });

    describe('pages/subordinated-list endpoint', () => {
      it('should anonymize path parameter', () => {
        const originalUrl =
          '/_api/v3/pages/subordinated-list?path=/user/documents&offset=0';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/pages/subordinated-list?path=%5BANONYMIZED%5D&offset=0',
        });
      });

      it('should handle encoded path parameters', () => {
        const originalUrl =
          '/_api/v3/pages/subordinated-list?path=%2Fuser%2Fdocs&includeEmpty=true';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/pages/subordinated-list?path=%5BANONYMIZED%5D&includeEmpty=true',
        });
      });
    });

    describe('page/check-page-existence endpoint', () => {
      it('should anonymize path parameter', () => {
        const originalUrl =
          '/_api/v3/page/check-page-existence?path=/project/wiki';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page/check-page-existence?path=%5BANONYMIZED%5D',
        });
      });

      it('should handle multiple parameters including path', () => {
        const originalUrl =
          '/_api/v3/page/check-page-existence?path=/docs/api&includePrivate=false';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page/check-page-existence?path=%5BANONYMIZED%5D&includePrivate=false',
        });
      });
    });

    describe('page/get-page-paths-with-descendant-count endpoint', () => {
      it('should anonymize paths parameter when present', () => {
        const originalUrl =
          '/_api/v3/page/get-page-paths-with-descendant-count?paths=["/docs","/wiki"]';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page/get-page-paths-with-descendant-count?paths=%5B%22%5BANONYMIZED%5D%22%5D',
        });
      });

      it('should handle encoded paths parameter', () => {
        const originalUrl =
          '/_api/v3/page/get-page-paths-with-descendant-count?paths=%5B%22%2Fdocs%22%5D';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page/get-page-paths-with-descendant-count?paths=%5B%22%5BANONYMIZED%5D%22%5D',
        });
      });

      it('should return null when no paths parameter is present', () => {
        const url =
          '/_api/v3/page/get-page-paths-with-descendant-count?includeEmpty=true';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(url)).toBe(true);

        const result = pageApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });
    });

    describe('mixed endpoint scenarios', () => {
      it('should handle pages/list endpoint without path parameter', () => {
        const url = '/_api/v3/pages/list?limit=20&sort=name';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(url)).toBe(true);

        const result = pageApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });

      it('should handle subordinated-list endpoint without path parameter', () => {
        const url = '/_api/v3/pages/subordinated-list?includeEmpty=false';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(url)).toBe(true);

        const result = pageApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });

      it('should handle check-page-existence endpoint without path parameter', () => {
        const url = '/_api/v3/page/check-page-existence?includePrivate=true';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(url)).toBe(true);

        const result = pageApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle empty path parameter', () => {
        const originalUrl = '/_api/v3/pages/list?path=&limit=5';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/v3/pages/list?path=%5BANONYMIZED%5D&limit=5',
        });
      });

      it('should handle root path parameter', () => {
        const originalUrl = '/_api/v3/page/check-page-existence?path=/';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page/check-page-existence?path=%5BANONYMIZED%5D',
        });
      });

      it('should handle empty paths array parameter', () => {
        const originalUrl =
          '/_api/v3/page/get-page-paths-with-descendant-count?paths=[]';

        // Verify canHandle returns true for this URL
        expect(pageApiModule.canHandle(originalUrl)).toBe(true);

        const result = pageApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target':
            '/_api/v3/page/get-page-paths-with-descendant-count?paths=%5BANONYMIZED%5D',
        });
      });
    });
  });
});
