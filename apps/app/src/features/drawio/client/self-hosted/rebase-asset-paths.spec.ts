// @vitest-environment happy-dom

import { DRAWIO_ASSET_PROXY_PATH } from '../../consts';
import { rebaseDrawioAssetPaths } from './rebase-asset-paths';

const DRAWIO_URI = 'http://localhost:8080/?offline=1&https=0';

describe('rebaseDrawioAssetPaths', () => {
  it.each`
    global            | reason
    ${'STENCIL_PATH'} | ${'stencil libraries are read with XMLHttpRequest'}
    ${'SHAPES_PATH'}  | ${'shape libraries are read with XMLHttpRequest'}
    ${'STYLE_PATH'}   | ${'styles are read with XMLHttpRequest'}
  `(
    "should route $global through GROWI's own origin because $reason",
    ({ global }: { global: 'STENCIL_PATH' | 'SHAPES_PATH' | 'STYLE_PATH' }) => {
      rebaseDrawioAssetPaths(DRAWIO_URI);

      // a path with no origin is same-origin to the page, which is the whole point:
      // a self-hosted draw.io sends no Access-Control-Allow-Origin header
      expect(window[global]).toMatch(
        new RegExp(`^${DRAWIO_ASSET_PROXY_PATH}/`),
      );
    },
  );

  it.each`
    global                | expected
    ${'GRAPH_IMAGE_PATH'} | ${'http://localhost:8080/img'}
    ${'mxBasePath'}       | ${'http://localhost:8080/mxgraph'}
    ${'mxImageBasePath'}  | ${'http://localhost:8080/mxgraph/images'}
  `(
    'should read $global straight from the instance, since <img> is not bound by the same-origin rule',
    ({
      global,
      expected,
    }: {
      global: 'GRAPH_IMAGE_PATH' | 'mxBasePath' | 'mxImageBasePath';
      expected: string;
    }) => {
      rebaseDrawioAssetPaths(DRAWIO_URI);

      expect(window[global]).toBe(expected);
    },
  );

  it('should drop the query DRAWIO_URI carries, which configures the editor and means nothing to an asset', () => {
    rebaseDrawioAssetPaths(DRAWIO_URI);

    expect(window.GRAPH_IMAGE_PATH).not.toContain('offline');
  });

  it('should keep the sub path when draw.io is deployed under one', () => {
    rebaseDrawioAssetPaths('http://example.com/drawio/');

    expect(window.mxImageBasePath).toBe(
      'http://example.com/drawio/mxgraph/images',
    );
  });

  it.each`
    drawioUri                       | reason
    ${'http://localhost:8080'}      | ${'no trailing slash'}
    ${'http://localhost:8080/'}     | ${'a trailing slash'}
    ${'http://localhost:8080//'}    | ${'more than one trailing slash'}
    ${'http://localhost:8080/?x=1'} | ${'a query'}
  `(
    'should point the lightbox at the instance itself when DRAWIO_URI has $reason',
    ({ drawioUri }: { drawioUri: string }) => {
      rebaseDrawioAssetPaths(drawioUri);

      expect(window.DRAWIO_LIGHTBOX_URL).toBe('http://localhost:8080');
    },
  );

  it('should be safe to apply repeatedly, since it may run on every render', () => {
    rebaseDrawioAssetPaths(DRAWIO_URI);
    const afterFirst = window.STENCIL_PATH;

    rebaseDrawioAssetPaths(DRAWIO_URI);

    expect(window.STENCIL_PATH).toBe(afterFirst);
  });
});
