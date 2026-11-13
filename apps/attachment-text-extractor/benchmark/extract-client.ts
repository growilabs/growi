import type { ExtractedPage, ExtractOutcome } from './extraction';

export interface ExtractEndpoint {
  /** The service's base URL; `/extract` is resolved against it. */
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
}

export interface CorpusFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asPage = (value: unknown): ExtractedPage | null => {
  if (!isFields(value)) return null;
  const { pageNumber, label, content } = value;
  const validNumber = pageNumber === null || typeof pageNumber === 'number';
  const validLabel = label === null || typeof label === 'string';
  if (!validNumber || !validLabel || typeof content !== 'string') return null;
  return { pageNumber, label, content };
};

const asPages = (body: unknown): ExtractedPage[] | null => {
  if (!isFields(body) || !Array.isArray(body.pages)) return null;
  const pages = body.pages.map(asPage);
  return pages.every((page): page is ExtractedPage => page != null)
    ? pages
    : null;
};

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const errorCode = (body: string): string | null => {
  const parsed = parseJson(body);
  return isFields(parsed) && typeof parsed.code === 'string'
    ? parsed.code
    : null;
};

const extractUrl = (baseUrl: string): URL =>
  new URL('extract', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const describeError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'timed out';
  }
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? `: ${error.cause.message}`
      : '';
  return `request failed (${error instanceof Error ? error.message : String(error)}${cause})`;
};

/**
 * Sends one file to `POST /extract`. Any failure (HTTP error, broken body,
 * timeout, no connection) comes back as an outcome, so one bad document
 * never stops a run. The token is never part of the outcome.
 */
export const extractDocument = async (
  endpoint: ExtractEndpoint,
  file: CorpusFile,
): Promise<ExtractOutcome> => {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
    file.fileName,
  );
  try {
    const response = await fetch(extractUrl(endpoint.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}` },
      body: form,
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      const code = errorCode(body);
      return {
        ok: false,
        reason: `HTTP ${response.status}${code == null ? '' : ` (${code})`}`,
      };
    }
    const pages = asPages(parseJson(body));
    return pages == null
      ? { ok: false, reason: 'unexpected response body (HTTP 200)' }
      : { ok: true, pages };
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  }
};
