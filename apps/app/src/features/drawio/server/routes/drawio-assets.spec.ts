import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  proxiableAssetExtension,
  readAsset,
  resolveAsset,
} from './drawio-assets';

describe('proxiableAssetExtension', () => {
  it.each`
    assetPath                                | expected  | reason
    ${'stencils/aws4.xml'}                   | ${'.xml'} | ${'a stencil library'}
    ${'stencils/electrical/abstract.xml'}    | ${'.xml'} | ${'a nested stencil library'}
    ${'shapes/mxAWS4.js'}                    | ${'.js'}  | ${'a shape library, which draw.io loads and evaluates'}
    ${'shapes/mockup/mxMockupButtons.js'}    | ${'.js'}  | ${'a nested shape library'}
    ${'styles/default.xml'}                  | ${'.xml'} | ${'a style sheet'}
    ${'styles/grapheditor.css'}              | ${'.css'} | ${'a stylesheet served as CSS'}
    ${'stencils/clipart/Gear_128x128.png'}   | ${'.png'} | ${'an image a stencil draws'}
    ${'styles/fonts/Architects-Regular.ttf'} | ${'.ttf'} | ${'a font a style sheet needs'}
  `(
    'should serve $reason as $expected',
    ({ assetPath, expected }: { assetPath: string; expected: string }) => {
      expect(proxiableAssetExtension(assetPath)).toBe(expected);
    },
  );

  it.each`
    assetPath                          | reason
    ${''}                              | ${'an empty path'}
    ${'index.html'}                    | ${'a file outside the proxied subtrees'}
    ${'js/viewer-static.min.js'}       | ${'the bundle itself, which the browser loads directly'}
    ${'WEB-INF/web.xml'}               | ${"the servlet container's configuration"}
    ${'stencils/../WEB-INF/web.xml'}   | ${'traversal out of a proxied subtree'}
    ${'stencils/..%2fweb.xml'}         | ${'traversal with an escaped separator'}
    ${'/stencils/aws4.xml'}            | ${'an absolute path'}
    ${'stencils/aws4.html'}            | ${'an extension that is not a library format'}
    ${'stencils/aws4'}                 | ${'no extension at all'}
    ${'http://evil.example.com/a.xml'} | ${'another host entirely'}
    ${'stencils/aws4.xml?x=1'}         | ${'a query smuggled into the path'}
  `('should refuse $reason', ({ assetPath }: { assetPath: string }) => {
    expect(proxiableAssetExtension(assetPath)).toBeUndefined();
  });
});

describe('resolveAsset', () => {
  it.each`
    drawioUri                               | expected
    ${'http://localhost:8080/?offline=1'}   | ${'http://localhost:8080/stencils/aws4.xml'}
    ${'http://localhost:8080'}              | ${'http://localhost:8080/stencils/aws4.xml'}
    ${'https://drawio.example.com/drawio/'} | ${'https://drawio.example.com/drawio/stencils/aws4.xml'}
  `(
    'should resolve against "$drawioUri"',
    ({ drawioUri, expected }: { drawioUri: string; expected: string }) => {
      expect(resolveAsset(drawioUri, 'stencils/aws4.xml')?.url).toBe(expected);
    },
  );

  it('should drop the query DRAWIO_URI carries, which configures the editor', () => {
    expect(
      resolveAsset('http://localhost:8080/?offline=1&https=0', 'shapes/a.js')
        ?.url,
    ).toBe('http://localhost:8080/shapes/a.js');
  });

  it('should return undefined when the configured value is not a URL', () => {
    expect(resolveAsset('not-a-url', 'stencils/aws4.xml')).toBeUndefined();
  });

  // Defence in depth: proxiableAssetExtension refuses all of the paths below first, so
  // these hold even if that allow-list were ever loosened.
  it.each`
    assetPath                          | reason
    ${'http://evil.example.com/a.xml'} | ${'an absolute URL'}
    ${'//evil.example.com/a.xml'}      | ${'a scheme-relative URL'}
    ${'\\\\evil.example.com/a.xml'}    | ${'a backslash-prefixed authority'}
  `(
    'should keep the request on the configured host even when the path is $reason',
    ({ assetPath }: { assetPath: string }) => {
      const url = resolveAsset('http://localhost:8080/drawio/', assetPath)?.url;

      expect(url).toBeDefined();
      expect(new URL(url ?? '').origin).toBe('http://localhost:8080');
    },
  );

  it('should return undefined when the path climbs out of the configured subtree', () => {
    expect(
      resolveAsset('http://localhost:8080/drawio/', '../../WEB-INF/web.xml'),
    ).toBeUndefined();
  });

  it('should keep an asset that resolves inside the subtree', () => {
    expect(
      resolveAsset('http://localhost:8080/drawio/', 'stencils/rack/hpe.xml')
        ?.url,
    ).toBe('http://localhost:8080/drawio/stencils/rack/hpe.xml');
  });
});

describe('readAsset', () => {
  // A stencil library is a byte stream, so the transport must not interpret it. The date
  // string is what makes this a regression guard: the shared axios wrapper rewrites values
  // that look like ISO dates and hands back a plain object instead of a Buffer, which
  // turned every stencil into a 502.
  const ASSET_BODY = Buffer.from(
    '<shapes><shape name="ec2" created="2024-01-02T03:04:05Z"/></shapes>',
    'utf8',
  );

  let server: Server;
  let origin: string;
  let lastPath: string | undefined;

  beforeEach(async () => {
    server = createServer((req, res) => {
      lastPath = req.url;
      if (req.url === '/stencils/aws4.xml') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(ASSET_BODY);
        return;
      }
      if (req.url === '/stencils/moved.xml') {
        res.writeHead(302, { location: '/stencils/aws4.xml' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should hand back exactly the bytes that were served', async () => {
    const body = await readAsset(`${origin}/stencils/aws4.xml`, {
      subtree: `${origin}/`,
    });

    expect(body).toBeInstanceOf(Buffer);
    expect(body?.equals(ASSET_BODY)).toBe(true);
  });

  it('should report success so a fallback read can be logged as such', async () => {
    const onSuccess = vi.fn();

    await readAsset(`${origin}/stencils/aws4.xml`, {
      subtree: `${origin}/`,
      onSuccess,
    });

    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it.each`
    path                      | reason
    ${'/stencils/absent.xml'} | ${'the instance does not ship the library'}
    ${'/stencils/moved.xml'}  | ${'following a redirect would leave the resolved origin'}
  `(
    'should return undefined when $reason',
    async ({ path }: { path: string }) => {
      expect(
        await readAsset(`${origin}${path}`, { subtree: `${origin}/` }),
      ).toBeUndefined();
    },
  );

  it('should not report success when nothing could be read', async () => {
    const onSuccess = vi.fn();

    await readAsset(`${origin}/stencils/absent.xml`, {
      subtree: `${origin}/`,
      onSuccess,
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('should return undefined rather than throw when the host is unreachable', async () => {
    // an air-gapped deployment reaching for the draw.io fallback ends up here
    expect(
      await readAsset('http://127.0.0.1:1/stencils/aws4.xml', {
        subtree: 'http://127.0.0.1:1/',
      }),
    ).toBeUndefined();
  });

  it('should request the asset path unchanged', async () => {
    await readAsset(`${origin}/stencils/aws4.xml`, { subtree: `${origin}/` });

    expect(lastPath).toBe('/stencils/aws4.xml');
  });
});

describe('readAsset — the subtree it was given', () => {
  it('should refuse a location outside it without making the request', async () => {
    // The guard is restated next to the request rather than trusted from the caller: the
    // location is built from a path the client chose, so "reads nothing outside this
    // subtree" has to hold where the request happens.
    let requested = false;
    const server = createServer((_req, res) => {
      requested = true;
      res.writeHead(200);
      res.end('should not have been read');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const body = await readAsset(`${origin}/stencils/aws4.xml`, {
        subtree: 'http://elsewhere.example.com/',
      });

      expect(body).toBeUndefined();
      expect(requested).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
