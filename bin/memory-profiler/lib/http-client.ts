/**
 * HttpClient
 *
 * A thin, cookie-aware HTTP client built on the Node.js built-in fetch API
 * (available since Node.js 18, stable in Node.js 24).
 *
 * Cookies received via Set-Cookie response headers are stored in an in-memory
 * Map and re-sent as Cookie request headers on subsequent requests to the same
 * origin.  This is sufficient for the load-driver use-case where a single
 * session per LoadDriver instance is all that is needed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  /** Base URL of the GROWI server, e.g. "http://localhost:3000". */
  readonly baseUrl: string;
  /** Optional initial cookie store.  Shared across all requests. */
  readonly cookieJar?: Map<string, string>;
}

export interface HttpClient {
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  put(path: string, body?: unknown): Promise<Response>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a Set-Cookie header value and returns the name and value pair.
 * Only the name=value portion is extracted; attributes (Path, HttpOnly, …)
 * are discarded because they are not needed for sidecar-to-server requests.
 */
function parseCookiePair(setCookieHeader: string): [string, string] | null {
  const firstPair = setCookieHeader.split(';')[0];
  const eqIdx = firstPair.indexOf('=');
  if (eqIdx < 0) return null;
  const name = firstPair.slice(0, eqIdx).trim();
  const value = firstPair.slice(eqIdx + 1).trim();
  return [name, value];
}

/**
 * Collects all Set-Cookie values from a Response and stores them in the jar.
 */
function storeCookies(response: Response, jar: Map<string, string>): void {
  // The Fetch API exposes Set-Cookie only as a single header concatenated with
  // commas in some runtimes.  Using getSetCookie() is the standard way in
  // Node.js 18+ / undici-based fetch.
  const setCookieHeaders: string[] =
    // @ts-expect-error: getSetCookie is available in Node 18+ fetch
    typeof response.headers.getSetCookie === 'function'
      ? // @ts-expect-error: getSetCookie is available in Node 18+ fetch
        (response.headers.getSetCookie() as string[])
      : [response.headers.get('set-cookie') ?? ''].filter(Boolean);

  for (const h of setCookieHeaders) {
    const pair = parseCookiePair(h);
    if (pair != null) {
      jar.set(pair[0], pair[1]);
    }
  }
}

/**
 * Builds the Cookie header string from the jar.
 * Returns an empty string when the jar is empty.
 */
function buildCookieHeader(jar: Map<string, string>): string {
  const pairs = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`);
  return pairs.join('; ');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new HttpClient instance.
 *
 * All requests to the GROWI server share the same cookie jar so that the
 * session established by initInstaller() is automatically propagated to
 * subsequent page CRUD, search, and Yjs requests.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { baseUrl } = options;
  const jar: Map<string, string> =
    options.cookieJar ?? new Map<string, string>();

  /** Builds the common request headers, injecting the current cookie jar. */
  function buildHeaders(
    extra?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    const cookie = buildCookieHeader(jar);
    if (cookie.length > 0) {
      headers.Cookie = cookie;
    }
    return headers;
  }

  /** Sends a request, stores any new cookies, and returns the Response. */
  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: buildHeaders(),
      // Disable redirect following so that 302 responses from login pages do
      // not silently mask authentication failures.
      redirect: 'manual',
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    storeCookies(response, jar);
    return response;
  }

  const get = (path: string): Promise<Response> => request('GET', path);
  const post = (path: string, body?: unknown): Promise<Response> =>
    request('POST', path, body);
  const put = (path: string, body?: unknown): Promise<Response> =>
    request('PUT', path, body);

  return { get, post, put };
}
