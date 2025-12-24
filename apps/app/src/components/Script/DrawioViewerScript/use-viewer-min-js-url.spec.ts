import { generateViewerMinJsUrl } from './use-viewer-min-js-url';

describe('generateViewerMinJsUrl', () => {
  it.each`
    drawioUri                                  | expected
    ${'http://localhost:8080'}                 | ${'http://localhost:8080/js/viewer-static.min.js'}
    ${'http://example.com'}                    | ${'http://example.com/js/viewer-static.min.js'}
    ${'http://example.com/drawio'}             | ${'http://example.com/drawio/js/viewer-static.min.js'}
    ${'http://example.com/?offline=1&https=0'} | ${'http://example.com/js/viewer-static.min.js?offline=1&https=0'}
  `(
    'should return the expected URL "$expected" when drawioUri is "$drawioUrk"',
    ({ drawioUri, expected }: { drawioUri: string; expected: string }) => {
      // Act
      const url = generateViewerMinJsUrl(drawioUri);

      // Assert
      expect(url).toBe(expected);
    },
  );
});
