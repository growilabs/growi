import type { IncomingMessage } from 'http';

import { beforeEach, describe, expect, it } from 'vitest';

import { searchApiModule } from './search-api-handler';

describe('searchApiModule', () => {
  const mockRequest = {} as IncomingMessage;

  beforeEach(() => {
    // No mocks needed - test actual behavior
  });

  describe('canHandle', () => {
    it.each`
      description                    | url                                | expected
      ${'search API endpoint'}       | ${'/_api/search?q=test'}           | ${true}
      ${'search API without query'}  | ${'/_api/search'}                  | ${true}
      ${'search endpoint'}           | ${'/_search?q=keyword'}            | ${true}
      ${'search endpoint without q'} | ${'/_search'}                      | ${true}
      ${'nested search API'}         | ${'/admin/_api/search?q=admin'}    | ${true}
      ${'nested search endpoint'}    | ${'/docs/_search?q=documentation'} | ${true}
      ${'other API endpoint'}        | ${'/_api/pages'}                   | ${false}
      ${'regular page path'}         | ${'/search/results'}               | ${false}
      ${'similar but different'}     | ${'/_api/search-results'}          | ${false}
      ${'root path'}                 | ${'/'}                             | ${false}
      ${'empty URL'}                 | ${''}                              | ${false}
    `('should return $expected for $description: $url', ({ url, expected }) => {
      const result = searchApiModule.canHandle(url);
      expect(result).toBe(expected);
    });
  });

  describe('handle', () => {
    describe('search API with query parameter', () => {
      it('should anonymize search query when q parameter is present', () => {
        const originalUrl = '/_api/search?q=sensitive search term&limit=10';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/search?q=%5BANONYMIZED%5D&limit=10',
        });
      });

      it('should handle encoded query parameters', () => {
        const originalUrl = '/_search?q=encoded%20search%20term&sort=relevance';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_search?q=%5BANONYMIZED%5D&sort=relevance',
        });
      });

      it('should handle empty query parameter', () => {
        const originalUrl = '/_api/search?q=&page=1';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/search?q=%5BANONYMIZED%5D&page=1',
        });
      });

      it('should handle complex query with special characters', () => {
        const originalUrl = '/_search?q=user:john+tag:important&format=json';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_search?q=%5BANONYMIZED%5D&format=json',
        });
      });
    });

    describe('search API without query parameter', () => {
      it('should return null when no q parameter is present', () => {
        const url = '/_api/search?limit=20&sort=date';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(url)).toBe(true);

        const result = searchApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });

      it('should return null for search endpoint without query', () => {
        const url = '/_search?page=2&format=json';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(url)).toBe(true);

        const result = searchApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });

      it('should return null for search API without any parameters', () => {
        const url = '/_api/search';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(url)).toBe(true);

        const result = searchApiModule.handle(mockRequest, url);

        expect(result).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle multiple q parameters', () => {
        const originalUrl = '/_api/search?q=first&q=second&limit=5';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/search?q=%5BANONYMIZED%5D&limit=5',
        });
      });

      it('should preserve other parameters while anonymizing q', () => {
        const originalUrl = '/_search?category=docs&q=secret&page=1&sort=date';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        // The actual output may have different parameter order due to URL parsing
        expect(result).toEqual({
          'http.target':
            '/_search?category=docs&q=%5BANONYMIZED%5D&page=1&sort=date',
        });
      });

      it('should handle URLs with fragments', () => {
        const originalUrl = '/_api/search?q=test#results';

        // Ensure canHandle returns true for this URL
        expect(searchApiModule.canHandle(originalUrl)).toBe(true);

        const result = searchApiModule.handle(mockRequest, originalUrl);

        expect(result).toEqual({
          'http.target': '/_api/search?q=%5BANONYMIZED%5D#results',
        });
      });
    });
  });
});
