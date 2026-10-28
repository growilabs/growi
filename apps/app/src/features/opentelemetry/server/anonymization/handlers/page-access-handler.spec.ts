import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { pageAccessModule } from './page-access-handler';

describe('pageAccessModule', () => {
  describe('canHandle', () => {
    it.each`
      description                              | url                            | expected
      ${'root path'}                           | ${'/'}                         | ${false}
      ${'API endpoint'}                        | ${'/_api/v3/search'}           | ${false}
      ${'static resource'}                     | ${'/static/css/style.css'}     | ${false}
      ${'favicon'}                             | ${'/favicon.ico'}              | ${false}
      ${'assets'}                              | ${'/assets/image.png'}         | ${false}
      ${'Next.js resource'}                    | ${'/_next/chunk.js'}           | ${false}
      ${'file with extension'}                 | ${'/file.pdf'}                 | ${false}
      ${'Users top page'}                      | ${'/user'}                     | ${false}
      ${'Users homepage'}                      | ${'/user/john'}                | ${true}
      ${'Users page'}                          | ${'/user/john/projects'}       | ${true}
      ${'page path with non-ASCII characters'} | ${'/Sandbox/日本語ページ'}     | ${true}
      ${'percent-encoded non-ASCII page path'} | ${'/Sandbox/%E6%97%A5'}        | ${true}
      ${'page path decoding to a "?"'}         | ${'/Sandbox/a%3Fb'}            | ${true}
      ${'API endpoint decoding to a "?"'}      | ${'/_api%3Fv3'}                | ${false}
      ${'page path'}                           | ${'/path/to/page'}             | ${true}
      ${'ObjectId path'}                       | ${'/58a4569921a8424d00a1aa0e'} | ${false}
    `('should return $expected for $description', ({ url, expected }) => {
      const result = pageAccessModule.canHandle(url);
      expect(result).toBe(expected);
    });
  });

  describe('handle', () => {
    describe('URL path anonymization', () => {
      it('should hash a non-ASCII page path the same whether it is encoded or not', () => {
        const mockRequest = mock<IncomingMessage>();
        const rawResult = pageAccessModule.handle(
          mockRequest,
          '/Sandbox/日本語',
        );
        const upperCaseResult = pageAccessModule.handle(
          mockRequest,
          '/Sandbox/%E6%97%A5%E6%9C%AC%E8%AA%9E',
        );
        const lowerCaseResult = pageAccessModule.handle(
          mockRequest,
          '/Sandbox/%e6%97%a5%e6%9c%ac%e8%aa%9e',
        );

        expect(rawResult?.['http.target']).toMatch(
          /^\/\[HASHED:[a-f0-9]{16}\]$/,
        );
        expect(upperCaseResult).toEqual(rawResult);
        expect(lowerCaseResult).toEqual(rawResult);
      });

      it.each`
        description                  | url                              | expectedPath
        ${'user subpage path'}       | ${'/user/john/projects'}         | ${'/user/[USERNAME_HASHED:96d9632f363564cc]/[HASHED:2577c0f557b2e4b5]'}
        ${'complex path'}            | ${'/wiki/project/documentation'} | ${'/[HASHED:22ca1a8b9f281349]'}
        ${'path with special chars'} | ${'/user-name_123/project!'}     | ${'/[HASHED:7aa6a8f4468baa96]'}
      `('should handle $description', ({ url, expectedPath }) => {
        // Ensure canHandle returns true before calling handle
        expect(pageAccessModule.canHandle(url)).toBe(true);

        const mockRequest = mock<IncomingMessage>();
        const result = pageAccessModule.handle(mockRequest, url);

        expect(result).toEqual({
          'http.target': expectedPath,
        });
      });
    });

    it('should preserve query parameters', () => {
      const mockRequest = mock<IncomingMessage>();
      const url = '/user/john?tab=projects&sort=date';

      // Ensure canHandle returns true before calling handle
      expect(pageAccessModule.canHandle(url)).toBe(true);

      const result = pageAccessModule.handle(mockRequest, url);

      expect(result).toEqual({
        'http.target':
          '/user/[USERNAME_HASHED:96d9632f363564cc]?tab=projects&sort=date',
      });
    });

    it('should handle complex query parameters', () => {
      const mockRequest = mock<IncomingMessage>();
      const url = '/wiki/page?search=test&tags[]=tag1&tags[]=tag2&limit=10';

      // Ensure canHandle returns true before calling handle
      expect(pageAccessModule.canHandle(url)).toBe(true);

      const result = pageAccessModule.handle(mockRequest, url);

      expect(result).toEqual({
        'http.target':
          '/[HASHED:2f4a824f8eacbc70]?search=test&tags[]=tag1&tags[]=tag2&limit=10',
      });
    });
  });
});
