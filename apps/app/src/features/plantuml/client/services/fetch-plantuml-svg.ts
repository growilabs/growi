import urljoin from 'url-join';

export type PlantumlSvgResult =
  | { ok: true; dataUrl: string }
  | {
      ok: false;
      reason: 'post-unavailable' | 'render-failed';
      status?: number;
    };

const MEMO_CAPACITY = 50;

const SVG_MEDIA_TYPE = 'image/svg+xml';

// Fixed media type, never taken from the response (research.md "SVG は blob URL でなく data URL で表示する").
const SVG_DATA_URL_PREFIX = `data:${SVG_MEDIA_TYPE};base64,`;

// Keeps String.fromCharCode's argument count well below engine limits.
const BASE64_CHUNK_SIZE = 0x8000;

const toSvgDataUrl = (body: ArrayBuffer): string => {
  const bytes = new Uint8Array(body);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE)),
    );
  }
  return SVG_DATA_URL_PREFIX + btoa(chunks.join(''));
};

// Holds in-flight and successful results only; failures remove themselves.
const memo = new Map<string, Promise<PlantumlSvgResult>>();

const isSvgResponse = (res: Response): boolean => {
  const mediaType = res.headers.get('Content-Type')?.split(';')[0];
  return mediaType?.trim().toLowerCase() === SVG_MEDIA_TYPE;
};

// 400 is accepted because PlantUML draws syntax errors into an SVG returned
// with 400 (research.md "構文エラーの SVG は図として表示する").
const isDiagramResponse = (res: Response): boolean =>
  (res.status === 200 || res.status === 400) && isSvgResponse(res);

const postUnavailable = (): PlantumlSvgResult => ({
  ok: false,
  reason: 'post-unavailable',
});

const renderFailed = (status: number): PlantumlSvgResult => ({
  ok: false,
  reason: 'render-failed',
  status,
});

// Classification order follows design.md "System Flows / 決定事項".
const classifyResponse = async (res: Response): Promise<PlantumlSvgResult> => {
  if (res.type === 'opaqueredirect') {
    return postUnavailable();
  }
  if (!isDiagramResponse(res)) {
    return renderFailed(res.status);
  }
  try {
    return { ok: true, dataUrl: toSvgDataUrl(await res.arrayBuffer()) };
  } catch {
    return renderFailed(res.status);
  }
};

const postSource = async (
  url: string,
  themedSource: string,
): Promise<PlantumlSvgResult> => {
  let res: Response;
  try {
    // Only a CORS-safelisted Content-Type, so the browser sends no preflight.
    res = await fetch(url, {
      method: 'POST',
      body: themedSource,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      redirect: 'manual',
      credentials: 'omit',
    });
  } catch {
    return postUnavailable();
  }
  return classifyResponse(res);
};

const evictOldest = (): void => {
  for (const key of memo.keys()) {
    if (memo.size <= MEMO_CAPACITY) {
      return;
    }
    memo.delete(key);
  }
};

/**
 * POST the themed source from the browser to `${plantumlUri}/svg`.
 * Never rejects; failures are returned as `{ ok: false }`.
 */
export const fetchPlantumlSvg = (
  plantumlUri: string,
  themedSource: string,
): Promise<PlantumlSvgResult> => {
  const url = urljoin(plantumlUri, '/svg');
  const key = JSON.stringify([url, themedSource]);

  const memoized = memo.get(key);
  if (memoized != null) {
    return memoized;
  }

  const pending = postSource(url, themedSource).then((result) => {
    // A newer request for the same key may already own the entry.
    if (!result.ok && memo.get(key) === pending) {
      memo.delete(key);
    }
    return result;
  });
  memo.set(key, pending);
  evictOldest();

  return pending;
};
