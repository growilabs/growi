/**
 * A thin wrapper around the POEditor API v2's upload/export/languages
 * endpoints.
 *
 * - The API token is injected by the caller (`createPoeditorClient`'s
 *   `apiToken`) — this file never reads `process.env` directly.
 * - `uploadTerms` enforces at least a 20-second gap between successive
 *   upload calls (POEditor's documented upload rate limit). The wait is
 *   injected as `sleep` so tests can fake it instead of waiting 20 real
 *   seconds.
 * - `exportTranslations` resolves the download URL from POEditor, then
 *   fetches that URL itself so callers never see the intermediate URL.
 * - Errors are returned as a `Result<T, PoeditorApiError>` rather than
 *   thrown; only a genuinely unexpected failure (a rejected/throwing fetch
 *   call) is caught and turned into a `network_error`.
 */

const POEDITOR_API_BASE = 'https://api.poeditor.com/v2';

// POEditor's documented upload rate limit: no more than one request every
// 20 seconds.
const UPLOAD_THROTTLE_MS = 20_000;

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type PoeditorApiError =
  | { readonly type: 'rate_limited' }
  | { readonly type: 'not_found' }
  | { readonly type: 'invalid_request'; readonly message: string }
  | { readonly type: 'network_error'; readonly cause: unknown };

export interface PoeditorClient {
  uploadTerms(input: {
    projectId: string;
    language: string;
    fileContent: string; // i18next JSON, stringified
  }): Promise<Result<void, PoeditorApiError>>;

  exportTranslations(input: {
    projectId: string;
    language: string;
  }): Promise<Result<string, PoeditorApiError>>; // resolves to the downloaded file content

  listLanguages(input: {
    projectId: string;
  }): Promise<
    Result<readonly { code: string; percentage: number }[], PoeditorApiError>
  >;
}

/** Injectable sleep function so tests can fake the upload throttle wait. */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface CreatePoeditorClientOptions {
  /** The POEditor API token, injected by the caller (never read from env here). */
  readonly apiToken: string;
  /** Injectable wait function for the upload throttle. Defaults to a real timer. */
  readonly sleep?: SleepFn;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the response body of a POEditor error response, extracting a message
 * when present. POEditor's error payload shape is
 * `{ response: { status, code, message } }`.
 */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      response?: { message?: string };
    };
    return body.response?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * Map a non-ok POEditor HTTP response to the corresponding PoeditorApiError.
 */
async function mapErrorResponse(res: Response): Promise<PoeditorApiError> {
  if (res.status === 429) {
    return { type: 'rate_limited' };
  }
  if (res.status === 404) {
    return { type: 'not_found' };
  }
  const message = await readErrorMessage(res);
  return { type: 'invalid_request', message };
}

/**
 * Run a POEditor call, catching any thrown/rejected error (network failure,
 * timeout, etc.) and turning it into a network_error Result rather than
 * letting it propagate — the only place in this file that intentionally
 * catches a generic exception.
 */
async function runCatchingNetworkError<T>(
  fn: () => Promise<Result<T, PoeditorApiError>>,
): Promise<Result<T, PoeditorApiError>> {
  try {
    return await fn();
  } catch (cause) {
    return { ok: false, error: { type: 'network_error', cause } };
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PoeditorClientImpl implements PoeditorClient {
  private readonly apiToken: string;

  private readonly sleep: SleepFn;

  // Timestamp (ms since epoch) of the last upload call, so consecutive
  // uploadTerms calls can be throttled to at least 20 seconds apart.
  private lastUploadAt: number | undefined;

  constructor(options: CreatePoeditorClientOptions) {
    this.apiToken = options.apiToken;
    this.sleep = options.sleep ?? defaultSleep;
  }

  uploadTerms(input: {
    projectId: string;
    language: string;
    fileContent: string;
  }): Promise<Result<void, PoeditorApiError>> {
    return runCatchingNetworkError(async () => {
      await this.throttleUpload();

      const form = new FormData();
      form.set('id', input.projectId);
      form.set('updating', 'terms_translations');
      form.set('language', input.language);
      form.set('sync_terms', '1');
      form.set('api_token', this.apiToken);
      form.set(
        'file',
        new Blob([input.fileContent], { type: 'application/json' }),
        `${input.language}.json`,
      );

      const res = await fetch(`${POEDITOR_API_BASE}/projects/upload`, {
        method: 'POST',
        body: form,
      });

      this.lastUploadAt = Date.now();

      if (!res.ok) {
        return { ok: false, error: await mapErrorResponse(res) };
      }
      return { ok: true, value: undefined };
    });
  }

  exportTranslations(input: {
    projectId: string;
    language: string;
  }): Promise<Result<string, PoeditorApiError>> {
    return runCatchingNetworkError(async () => {
      const form = new FormData();
      form.set('id', input.projectId);
      form.set('language', input.language);
      form.set('type', 'i18next');
      form.set('api_token', this.apiToken);

      const res = await fetch(`${POEDITOR_API_BASE}/projects/export`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        return { ok: false, error: await mapErrorResponse(res) };
      }

      const body = (await res.json()) as { result: { url: string } };
      const downloadRes = await fetch(body.result.url);
      if (!downloadRes.ok) {
        return { ok: false, error: await mapErrorResponse(downloadRes) };
      }
      const fileContent = await downloadRes.text();
      return { ok: true, value: fileContent };
    });
  }

  listLanguages(input: {
    projectId: string;
  }): Promise<
    Result<readonly { code: string; percentage: number }[], PoeditorApiError>
  > {
    return runCatchingNetworkError(async () => {
      const form = new FormData();
      form.set('id', input.projectId);
      form.set('api_token', this.apiToken);

      const res = await fetch(`${POEDITOR_API_BASE}/languages/list`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        return { ok: false, error: await mapErrorResponse(res) };
      }

      const body = (await res.json()) as {
        result: { languages: { code: string; percentage: number }[] };
      };
      return { ok: true, value: body.result.languages };
    });
  }

  /**
   * Enforce at least a 20-second gap since the previous uploadTerms call.
   * The first call in a client's lifetime never waits.
   */
  private async throttleUpload(): Promise<void> {
    if (this.lastUploadAt == null) {
      return;
    }
    const elapsed = Date.now() - this.lastUploadAt;
    const remaining = UPLOAD_THROTTLE_MS - elapsed;
    if (remaining > 0) {
      await this.sleep(remaining);
    }
  }
}

export function createPoeditorClient(
  options: CreatePoeditorClientOptions,
): PoeditorClient {
  return new PoeditorClientImpl(options);
}
