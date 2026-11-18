import { type EsPlugins, parsePlugins } from './es-queries';

// The few Elasticsearch REST calls the benchmark makes, over fetch.

const TIMEOUT_MS = 30_000;

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const endpoint = (url: string, path: string): URL =>
  new URL(path, url.endsWith('/') ? url : `${url}/`);

type Payload = { readonly json: unknown } | { readonly ndjson: string };

const payloadInit = (payload: Payload): RequestInit =>
  'json' in payload
    ? {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload.json),
      }
    : {
        headers: { 'content-type': 'application/x-ndjson' },
        body: payload.ndjson,
      };

const request = async (
  url: string,
  method: string,
  path: string,
  payload?: Payload,
): Promise<unknown> => {
  const response = await fetch(endpoint(url, path), {
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(payload == null ? {} : payloadInit(payload)),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Elasticsearch ${method} /${path}: HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return text === '' ? null : JSON.parse(text);
};

export const fetchPlugins = async (url: string): Promise<EsPlugins> =>
  parsePlugins(await request(url, 'GET', '_cat/plugins?format=json'));

/** The tokens `_analyze` gives for the text with the analysis definition. */
export const analyzeTokens = async (
  url: string,
  analysis: Fields,
  text: string,
): Promise<string[]> => {
  const body = await request(url, 'POST', '_analyze', {
    json: { ...analysis, text },
  });
  const tokens =
    isFields(body) && Array.isArray(body.tokens) ? body.tokens : [];
  return tokens.flatMap((token) =>
    isFields(token) && typeof token.token === 'string' ? [token.token] : [],
  );
};

export const createIndex = async (
  url: string,
  name: string,
  body: unknown,
): Promise<void> => {
  await request(url, 'PUT', encodeURIComponent(name), { json: body });
};

/** Indexes the NDJSON and refreshes, so the next search sees it. */
export const bulkIndex = async (
  url: string,
  name: string,
  ndjson: string,
): Promise<void> => {
  const body = await request(
    url,
    'POST',
    `${encodeURIComponent(name)}/_bulk?refresh=true`,
    { ndjson },
  );
  if (isFields(body) && body.errors === true) {
    throw new Error(`Elasticsearch _bulk into ${name} reported errors`);
  }
};

export const search = (
  url: string,
  name: string,
  query: unknown,
): Promise<unknown> =>
  request(url, 'POST', `${encodeURIComponent(name)}/_search`, { json: query });

/** Deletes the index; an index that is already gone is fine. */
export const deleteIndex = async (url: string, name: string): Promise<void> => {
  await request(
    url,
    'DELETE',
    `${encodeURIComponent(name)}?ignore_unavailable=true`,
  );
};

/** Index names matching the pattern (e.g. `benchmark-*`). */
export const listIndices = async (
  url: string,
  pattern: string,
): Promise<string[]> => {
  const body = await request(
    url,
    'GET',
    `_cat/indices/${encodeURIComponent(pattern)}?format=json&h=index`,
  );
  return Array.isArray(body)
    ? body.flatMap((row) =>
        isFields(row) && typeof row.index === 'string' ? [row.index] : [],
      )
    : [];
};
