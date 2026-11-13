import { fetchPlantumlSvg } from './fetch-plantuml-svg';

const PLANTUML_URI = 'http://localhost:8080/plantuml';
const SVG_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>';

const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;base64,';

// Fails the test unless the result is a base64 SVG data URL, then returns the
// SVG text it carries.
const decodeSvgDataUrl = (dataUrl: string): string => {
  expect(dataUrl.startsWith(SVG_DATA_URL_PREFIX)).toBe(true);
  return Buffer.from(
    dataUrl.slice(SVG_DATA_URL_PREFIX.length),
    'base64',
  ).toString('utf8');
};

// The memo cap from design.md ("fetch-plantuml-svg — 新規": 目安 50件).
const MEMO_CAPACITY = 50;

// The memo is module-level and survives across tests, so every test sends
// sources that no other test uses.
let sourceCounter = 0;
const uniqueSource = (label = 'diagram'): string => {
  sourceCounter += 1;
  return `@startuml\n' ${label} #${sourceCounter}\nBob -> Alice : hello\n@enduml`;
};

const svgResponse = (
  status = 200,
  contentType = 'image/svg+xml',
  body = SVG_BODY,
): Response =>
  new Response(body, { status, headers: { 'Content-Type': contentType } });

// Node's Response cannot be constructed with status 0 / type 'opaqueredirect',
// so the type is overridden on a real instance without a Content-Type.
const opaqueRedirectResponse = (): Response => {
  const res = new Response(null, { status: 200 });
  Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
  return res;
};

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('fetchPlantumlSvg', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async () => svgResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('request', () => {
    it.each`
      plantumlUri                          | expectedUrl
      ${'http://localhost:8080/plantuml'}  | ${'http://localhost:8080/plantuml/svg'}
      ${'http://localhost:8080/plantuml/'} | ${'http://localhost:8080/plantuml/svg'}
      ${'https://plantuml.example.com'}    | ${'https://plantuml.example.com/svg'}
    `(
      'POSTs the source to $expectedUrl for $plantumlUri with only a text/plain UTF-8 Content-Type, no redirect following and no cookies',
      async ({
        plantumlUri,
        expectedUrl,
      }: {
        plantumlUri: string;
        expectedUrl: string;
      }) => {
        const source = uniqueSource();

        await fetchPlantumlSvg(plantumlUri, source);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(expectedUrl, {
          method: 'POST',
          body: source,
          headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
          redirect: 'manual',
          credentials: 'omit',
        });
      },
    );

    it('sends a non-ASCII source as the raw string body', async () => {
      const source = uniqueSource('日本語のクラス名 名前空間::クラス');

      await fetchPlantumlSvg(PLANTUML_URI, source);

      expect(fetchMock.mock.calls[0][1]?.body).toBe(source);
    });
  });

  describe('response classification', () => {
    it.each`
      status | contentType
      ${200} | ${'image/svg+xml'}
      ${400} | ${'image/svg+xml'}
      ${200} | ${'image/svg+xml;charset=utf-8'}
      ${400} | ${'Image/SVG+XML; charset=UTF-8'}
    `(
      'returns the SVG as the diagram for status $status with Content-Type "$contentType"',
      async ({
        status,
        contentType,
      }: {
        status: number;
        contentType: string;
      }) => {
        fetchMock.mockResolvedValueOnce(
          svgResponse(status, contentType, SVG_BODY),
        );

        const result = await fetchPlantumlSvg(PLANTUML_URI, uniqueSource());

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(decodeSvgDataUrl(result.dataUrl)).toBe(SVG_BODY);
      },
    );

    it('treats a redirect as POST being unavailable', async () => {
      fetchMock.mockResolvedValueOnce(opaqueRedirectResponse());

      const result = await fetchPlantumlSvg(PLANTUML_URI, uniqueSource());

      expect(result).toEqual({ ok: false, reason: 'post-unavailable' });
    });

    it('resolves (does not reject) with POST being unavailable when fetch throws', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(
        fetchPlantumlSvg(PLANTUML_URI, uniqueSource()),
      ).resolves.toEqual({ ok: false, reason: 'post-unavailable' });
    });

    it.each`
      status | contentType
      ${500} | ${'image/svg+xml'}
      ${502} | ${'image/svg+xml'}
      ${500} | ${'text/html'}
      ${413} | ${'text/html'}
      ${200} | ${'text/html;charset=utf-8'}
      ${400} | ${'text/html'}
      ${200} | ${'image/png'}
    `(
      'treats status $status with Content-Type "$contentType" as a render failure carrying the status',
      async ({
        status,
        contentType,
      }: {
        status: number;
        contentType: string;
      }) => {
        fetchMock.mockResolvedValueOnce(
          new Response('<html>error</html>', {
            status,
            headers: { 'Content-Type': contentType },
          }),
        );

        const result = await fetchPlantumlSvg(PLANTUML_URI, uniqueSource());

        expect(result).toEqual({ ok: false, reason: 'render-failed', status });
      },
    );

    it('treats a response without a Content-Type as a render failure', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

      const result = await fetchPlantumlSvg(PLANTUML_URI, uniqueSource());

      expect(result).toEqual({
        ok: false,
        reason: 'render-failed',
        status: 200,
      });
    });

    it('treats an SVG body that cannot be read as a render failure', async () => {
      const brokenBody = new ReadableStream({
        start(controller) {
          controller.error(new Error('connection reset'));
        },
      });
      fetchMock.mockResolvedValueOnce(
        new Response(brokenBody, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );

      await expect(
        fetchPlantumlSvg(PLANTUML_URI, uniqueSource()),
      ).resolves.toEqual({ ok: false, reason: 'render-failed', status: 200 });
    });
  });

  describe('data URL', () => {
    it('keeps non-ASCII SVG text intact', async () => {
      const japaneseSvg =
        '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語のクラス名 名前空間::クラス</text></svg>';
      fetchMock.mockResolvedValueOnce(
        svgResponse(200, 'image/svg+xml;charset=utf-8', japaneseSvg),
      );

      const result = await fetchPlantumlSvg(PLANTUML_URI, uniqueSource());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(decodeSvgDataUrl(result.dataUrl)).toBe(japaneseSvg);
    });

    it('converts a large SVG (about 1 MB)', async () => {
      const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg">${'<text>図</text>'.repeat(70_000)}</svg>`;
      expect(new TextEncoder().encode(largeSvg).length).toBeGreaterThan(
        1_000_000,
      );
      fetchMock.mockResolvedValueOnce(
        svgResponse(200, 'image/svg+xml', largeSvg),
      );

      const result = await fetchPlantumlSvg(PLANTUML_URI, uniqueSource());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(decodeSvgDataUrl(result.dataUrl)).toBe(largeSvg);
    });
  });

  describe('memo', () => {
    it('does not send the same source to the same destination twice', async () => {
      const source = uniqueSource();

      await fetchPlantumlSvg(PLANTUML_URI, source);
      const second = await fetchPlantumlSvg(PLANTUML_URI, source);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(decodeSvgDataUrl(second.dataUrl)).toBe(SVG_BODY);
    });

    it('sends once for two concurrent requests of the same source', async () => {
      const pending = deferred<Response>();
      fetchMock.mockReturnValueOnce(pending.promise);
      const source = uniqueSource();

      const firstCall = fetchPlantumlSvg(PLANTUML_URI, source);
      const secondCall = fetchPlantumlSvg(PLANTUML_URI, source);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      pending.resolve(svgResponse());
      const [first, second] = await Promise.all([firstCall, secondCall]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });

    it('sends again for a different source', async () => {
      await fetchPlantumlSvg(PLANTUML_URI, uniqueSource('light'));
      await fetchPlantumlSvg(PLANTUML_URI, uniqueSource('dark'));

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('sends again for the same source to a different destination', async () => {
      const source = uniqueSource();

      await fetchPlantumlSvg('http://plantuml-a.example.com', source);
      await fetchPlantumlSvg('http://plantuml-b.example.com', source);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'http://plantuml-a.example.com/svg',
        'http://plantuml-b.example.com/svg',
      ]);
    });

    it.each`
      failure                 | arrange
      ${'fetch throws'}       | ${(m: typeof fetchMock) => m.mockRejectedValueOnce(new TypeError('Failed to fetch'))}
      ${'redirect'}           | ${(m: typeof fetchMock) => m.mockResolvedValueOnce(opaqueRedirectResponse())}
      ${'server error (500)'} | ${(m: typeof fetchMock) => m.mockResolvedValueOnce(new Response('', { status: 500 }))}
    `(
      'does not keep a failure ($failure): the next request sends again, and its success is kept',
      async ({ arrange }: { arrange: (m: typeof fetchMock) => void }) => {
        arrange(fetchMock);
        const source = uniqueSource();

        const failed = await fetchPlantumlSvg(PLANTUML_URI, source);
        const retried = await fetchPlantumlSvg(PLANTUML_URI, source);
        const reused = await fetchPlantumlSvg(PLANTUML_URI, source);

        expect(failed.ok).toBe(false);
        expect(retried.ok).toBe(true);
        expect(reused.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      },
    );

    it('evicts the oldest entry once the number of entries exceeds the cap', async () => {
      const sources = Array.from({ length: MEMO_CAPACITY + 1 }, () =>
        uniqueSource(),
      );
      await Promise.all(
        sources.map((source) => fetchPlantumlSvg(PLANTUML_URI, source)),
      );
      fetchMock.mockClear();

      await fetchPlantumlSvg(PLANTUML_URI, sources[sources.length - 1]);
      await fetchPlantumlSvg(PLANTUML_URI, sources[1]);
      expect(fetchMock).not.toHaveBeenCalled();

      await fetchPlantumlSvg(PLANTUML_URI, sources[0]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps a newer request for the same source when an older, evicted request fails afterwards', async () => {
      const olderFetch = deferred<Response>();
      fetchMock.mockReturnValueOnce(olderFetch.promise);
      const source = uniqueSource();

      const olderCall = fetchPlantumlSvg(PLANTUML_URI, source);
      await Promise.all(
        Array.from({ length: MEMO_CAPACITY }, () =>
          fetchPlantumlSvg(PLANTUML_URI, uniqueSource()),
        ),
      );
      const newerCall = fetchPlantumlSvg(PLANTUML_URI, source);
      olderFetch.reject(new TypeError('Failed to fetch'));

      expect((await olderCall).ok).toBe(false);
      expect((await newerCall).ok).toBe(true);
      fetchMock.mockClear();

      const reused = await fetchPlantumlSvg(PLANTUML_URI, source);

      expect(reused.ok).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
