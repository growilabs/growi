import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';

import { configManager } from '~/server/service/config-manager';

import { DRAWIO_ASSET_PROXY_PATH } from '../../consts';
import {
  drawioAssetsRouterFactory,
  proxiableAssetExtension,
  readAsset,
  resolveAsset,
} from './drawio-assets';

/**
 * The two hosts the route is allowed to reach are compile-time constants: draw.io's own
 * viewer, and — through `isSelfHostedDrawio` — the origin that counts as *not* self-hosted.
 * Both are pointed at a local fixture in the router tests below, which is the only way to
 * observe whether a request to them would have been made instead of letting it leave the
 * machine. Everything else `consts` exports keeps its real value.
 */
const { drawioHosts } = vi.hoisted(() => ({
  drawioHosts: {
    viewerOrigin: 'https://viewer.diagrams.net',
    defaultOrigin: 'https://embed.diagrams.net',
  },
}));

vi.mock('../../consts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../consts')>();
  return {
    ...actual,
    get VIEWER_DIAGRAMS_NET_ORIGIN() {
      return drawioHosts.viewerOrigin;
    },
    get DEFAULT_DRAWIO_ORIGIN() {
      return drawioHosts.defaultOrigin;
    },
  };
});

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type FixtureFile = { body: Buffer; contentType: string };

type Fixture = {
  origin: string;
  port: number;
  /** Every path the fixture was asked for, so "no outbound request" can be asserted. */
  requestedPaths: string[];
  serve: (path: string, file: FixtureFile) => void;
  close: () => Promise<void>;
};

/**
 * A stand-in for a draw.io host: it serves the paths a test registers, answers 404 for
 * everything else, and records every path it was asked for.
 *
 * The recording is what makes "no outbound request" testable: a 404 from the route alone
 * cannot be told apart from a request that went out and came back 404.
 */
const startFixture = async (): Promise<Fixture> => {
  const files = new Map<string, FixtureFile>();
  const requestedPaths: string[] = [];

  const server = createServer((req, res) => {
    const path = req.url ?? '';
    requestedPaths.push(path);

    const file = files.get(path);
    if (file == null) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': file.contentType });
    res.end(file.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('The fixture server did not bind to a TCP port');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requestedPaths,
    serve: (path, file) => {
      files.set(path, file);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

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
    const host = await startFixture();
    // Registered so that reaching the host would produce a body rather than a 404: that is
    // what makes both assertions below meaningful.
    host.serve('/stencils/aws4.xml', {
      body: Buffer.from('should not have been read', 'utf8'),
      contentType: 'application/xml',
    });

    try {
      const body = await readAsset(`${host.origin}/stencils/aws4.xml`, {
        subtree: 'http://elsewhere.example.com/',
      });

      expect(body).toBeUndefined();
      expect(host.requestedPaths).toEqual([]);
    } finally {
      await host.close();
    }
  });
});

describe('readAsset — the size limit', () => {
  /**
   * Restated here rather than read from the module: the cap is private, so the test has to
   * declare the value it expects. That is what makes a change to the production value show
   * up as a failure instead of silently redefining what the test proves.
   */
  const MAX_CONTENT_LENGTH = 64 * 1024 * 1024;

  /**
   * The largest library draw.io actually ships (`stencils/aws4.xml`, 6.5 MB on 31.1.5),
   * rounded up. The cap is a runaway guard, not a budget, so this size must go through.
   */
  const LARGEST_REAL_LIBRARY = 7 * 1024 * 1024;

  let host: Fixture;

  beforeEach(async () => {
    host = await startFixture();
  });

  afterEach(async () => {
    await host.close();
  });

  const readBodyOfSize = (byteLength: number, onSuccess: () => void) => {
    host.serve('/stencils/aws4.xml', {
      // Content is irrelevant here; only the length is. The cap is applied to the body that
      // was read, not to a declared Content-Length, so the bytes have to really be sent.
      body: Buffer.alloc(byteLength, 0x41),
      contentType: 'application/xml',
    });

    return readAsset(`${host.origin}/stencils/aws4.xml`, {
      subtree: `${host.origin}/`,
      onSuccess,
    });
  };

  it('should refuse a body past the size limit', async () => {
    const onSuccess = vi.fn();

    const body = await readBodyOfSize(MAX_CONTENT_LENGTH + 1, onSuccess);

    // Asserted through `byteLength` rather than on the Buffer itself: when this fails the
    // body is 64 MiB, and vitest would try to render that whole Buffer as a diff and run
    // the worker out of heap — an OOM crash instead of a readable failure.
    expect(body?.byteLength).toBeUndefined();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // The other side of the same limit. Without this, a cap lowered under a real library would
  // still satisfy the test above — and that is the failure the cap's own comment warns
  // about: shapes that silently stop rendering because their library was refused.
  it('should serve a body the size of the largest library draw.io ships', async () => {
    const onSuccess = vi.fn();

    const body = await readBodyOfSize(LARGEST_REAL_LIBRARY, onSuccess);

    expect(body?.byteLength).toBe(LARGEST_REAL_LIBRARY);
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});

/**
 * Answer only the key the route actually reads, so a rename of `app:drawioUri`
 * turns these tests RED instead of leaving them green against a route that no
 * longer finds its configuration.
 */
const configureDrawioUri = (drawioUri: string): void => {
  vi.mocked(configManager.getConfig).mockImplementation((key) =>
    key === 'app:drawioUri' ? drawioUri : undefined,
  );
};

describe('drawioAssetsRouterFactory', () => {
  const XML_ASSET = Buffer.from('<shapes><shape name="ec2"/></shapes>', 'utf8');

  // An image a stencil draws. Deliberately not valid text (a lone 0x89, a 0x00, a 0xff),
  // so a transport that re-encodes the body instead of passing the bytes through cannot
  // satisfy the byte-for-byte assertion.
  const PNG_ASSET = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xc3, 0x28,
    0x80,
  ]);

  const ASSET_FROM_DRAWIO = Buffer.from(
    '<shapes><shape name="shipped-only-by-drawio"/></shapes>',
    'utf8',
  );

  // What the upstream declares must never reach the client: the response is served from
  // GROWI's own origin, so passing an upstream text/html through would make it a
  // same-origin document. Every fixture answer below declares this.
  const MISDECLARED_UPSTREAM_TYPE = 'text/html; charset=utf-8';

  /** stands in for the configured self-hosted instance */
  let instance: Fixture;
  /** stands in for draw.io's own viewer.diagrams.net */
  let drawio: Fixture;
  let app: Express;
  let actualDefaultOrigin: string;

  beforeAll(async () => {
    const actual =
      await vi.importActual<typeof import('../../consts')>('../../consts');
    actualDefaultOrigin = actual.DEFAULT_DRAWIO_ORIGIN;
  });

  beforeEach(async () => {
    instance = await startFixture();
    drawio = await startFixture();

    drawioHosts.viewerOrigin = drawio.origin;
    // The real value: the fixture standing in for the configured instance then counts as
    // self-hosted for the same reason a real instance would.
    drawioHosts.defaultOrigin = actualDefaultOrigin;

    configureDrawioUri(instance.origin);

    // Mounted the way server/routes/index.js mounts it, and with nothing else in front of
    // it — see the unauthenticated case at the end of this describe.
    app = express();
    app.use(DRAWIO_ASSET_PROXY_PATH, drawioAssetsRouterFactory());
  });

  afterEach(async () => {
    await Promise.all([instance.close(), drawio.close()]);
  });

  const get = (assetPath: string) =>
    request(app).get(`${DRAWIO_ASSET_PROXY_PATH}/${assetPath}`);

  it.each`
    assetPath                          | reason
    ${'index.html'}                    | ${'a file outside the proxied subtrees'}
    ${'js/viewer-static.min.js'}       | ${'the bundle itself, which the browser loads directly'}
    ${'WEB-INF/web.xml'}               | ${"the servlet container's configuration"}
    ${'stencils/..%2fWEB-INF/web.xml'} | ${'traversal out of a proxied subtree'}
    ${'stencils/aws4.html'}            | ${'an extension that is not a library format'}
  `(
    'should answer 404 and read nothing when the path is $reason',
    async ({ assetPath }: { assetPath: string }) => {
      // Registered so that a request reaching the instance would be answered with a body:
      // without this, "404" would prove nothing, because a forwarded request would come
      // back 404 as well and the route would turn that into a 502.
      instance.serve(`/${assetPath}`, {
        body: XML_ASSET,
        contentType: MISDECLARED_UPSTREAM_TYPE,
      });

      const res = await get(assetPath);

      expect(res.status).toBe(404);
      expect(instance.requestedPaths).toEqual([]);
      expect(drawio.requestedPaths).toEqual([]);
    },
  );

  it("should answer 404 and read nothing when the configured draw.io is draw.io's own", async () => {
    // draw.io's own viewer sends the CORS header that makes this route unnecessary, so a
    // default deployment must not leave an outbound fetch reachable here. The origin that
    // counts as "draw.io's own" is pointed at the fixture for this test, so that a request
    // to that host can be seen; the fixture answers the asset, so a route that skipped the
    // gate would come back 200.
    drawioHosts.defaultOrigin = instance.origin;
    configureDrawioUri(`${instance.origin}/`);
    instance.serve('/stencils/aws4.xml', {
      body: XML_ASSET,
      contentType: MISDECLARED_UPSTREAM_TYPE,
    });

    const res = await get('stencils/aws4.xml');

    expect(res.status).toBe(404);
    expect(instance.requestedPaths).toEqual([]);
    expect(drawio.requestedPaths).toEqual([]);
  });

  it('should answer 404 and read nothing when the location leaves the configured subtree', async () => {
    // A DRAWIO_URI carrying credentials is the way to reach this gate: `origin` drops
    // `user:pass@` but `href` keeps it, so the resolved location never starts with the
    // subtree the check is made against. (A traversal path never gets this far — the
    // allow-list above refuses it.) design.md lists this form as a 404.
    configureDrawioUri(`http://user:pass@127.0.0.1:${instance.port}/`);
    instance.serve('/stencils/aws4.xml', {
      body: XML_ASSET,
      contentType: MISDECLARED_UPSTREAM_TYPE,
    });

    const res = await get('stencils/aws4.xml');

    expect(res.status).toBe(404);
    expect(instance.requestedPaths).toEqual([]);
    expect(drawio.requestedPaths).toEqual([]);
  });

  it.each`
    assetPath                              | contentType                                | asset
    ${'stencils/aws4.xml'}                 | ${'application/xml; charset=utf-8'}        | ${XML_ASSET}
    ${'stencils/clipart/Gear_128x128.png'} | ${'image/png'}                             | ${PNG_ASSET}
    ${'shapes/mxAWS4.js'}                  | ${'application/javascript; charset=utf-8'} | ${XML_ASSET}
  `(
    'should serve $assetPath as $contentType, byte for byte',
    async ({
      assetPath,
      contentType,
      asset,
    }: {
      assetPath: string;
      contentType: string;
      asset: Buffer;
    }) => {
      instance.serve(`/${assetPath}`, {
        body: asset,
        contentType: MISDECLARED_UPSTREAM_TYPE,
      });

      const res = await get(assetPath).responseType('blob');

      expect(res.status).toBe(200);
      // Decided from the extension, never copied from what the instance declared
      expect(res.headers['content-type']).toBe(contentType);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');

      const served: Buffer = res.body;
      expect(Buffer.isBuffer(served)).toBe(true);
      expect(served).toEqual(asset);

      // Nothing left the configured instance: the fallback is for libraries it does not
      // ship, not something every request pays for.
      expect(instance.requestedPaths).toEqual([`/${assetPath}`]);
      expect(drawio.requestedPaths).toEqual([]);
    },
  );

  it('should serve the asset from draw.io itself when the instance does not ship it', async () => {
    // Older draw.io images carry no stencils/ or shapes/ directory at all, so on such an
    // instance the library exists only on draw.io's own host.
    drawio.serve('/stencils/aws4.xml', {
      body: ASSET_FROM_DRAWIO,
      contentType: MISDECLARED_UPSTREAM_TYPE,
    });

    const res = await get('stencils/aws4.xml').responseType('blob');

    expect(res.status).toBe(200);
    const served: Buffer = res.body;
    expect(served).toEqual(ASSET_FROM_DRAWIO);
    expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // The instance is asked first; draw.io is only reached because it answered nothing.
    expect(instance.requestedPaths).toEqual(['/stencils/aws4.xml']);
    expect(drawio.requestedPaths).toEqual(['/stencils/aws4.xml']);
  });

  it('should answer 502 when neither the instance nor draw.io can serve the asset', async () => {
    // Neither fixture has the path registered, so both answer 404.
    const res = await get('stencils/aws4.xml');

    expect(res.status).toBe(502);
    expect(instance.requestedPaths).toEqual(['/stencils/aws4.xml']);
    expect(drawio.requestedPaths).toEqual(['/stencils/aws4.xml']);
  });

  it('should answer a request that carries no session, since a shared page may be read by someone not logged in', async () => {
    // What this shows is that the router itself asks for nothing: it is mounted here with
    // no middleware in front of it and answers a request with no session cookie and no
    // Authorization header. That the real mount keeps it out of the authentication chain
    // is decided in server/routes/index.js and is not covered here.
    instance.serve('/shapes/mxAWS4.js', {
      body: XML_ASSET,
      contentType: MISDECLARED_UPSTREAM_TYPE,
    });

    const res = await get('shapes/mxAWS4.js');

    expect(res.status).toBe(200);
  });
});
