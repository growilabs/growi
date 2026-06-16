import { Readable } from 'node:stream';
import type {
  ComposeViewRequest,
  ComposeViewResponse,
  StorageStatsResponse,
} from '@growi/core/dist/interfaces/vault';

import { vaultSettingsService } from '~/features/growi-vault/server/services/vault-settings-service';

// Timeout for all vault-manager requests: 10 minutes in milliseconds.
const REQUEST_TIMEOUT_MS = 600_000;

/**
 * HTTP client for communicating with the growi-vault-manager service.
 *
 * All requests carry a shared secret via the Authorization header to
 * authenticate with the vault-manager's internal endpoints.
 */
export interface VaultManagerClient {
  /**
   * Compose a per-user view by calling POST /internal/compose-view on vault-manager.
   * Returns the view ref and the commit OID that identifies the synthesised tree.
   */
  composeView(req: ComposeViewRequest): Promise<ComposeViewResponse>;

  /**
   * Proxy a git smart-HTTP request to vault-manager.
   *
   * The method, path, and request body are forwarded verbatim. The view ref is
   * communicated via the X-Vault-View-Ref header. The response body is returned
   * as a stream — callers MUST NOT buffer it in memory.
   */
  proxyGitRequest(opts: {
    method: 'GET' | 'POST';
    path: '/internal/git/info/refs' | '/internal/git/git-upload-pack';
    viewRef: string;
    queryString?: string;
    requestBody?: NodeJS.ReadableStream;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: NodeJS.ReadableStream;
  }>;

  /**
   * Fetch storage observability statistics from vault-manager.
   * Used by the admin UI to display namespace counts, repo sizes, and GC timestamps.
   */
  getStorageStats(): Promise<StorageStatsResponse>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build common request headers that are attached to every vault-manager call.
 */
function buildCommonHeaders(secret: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
  };
}

/**
 * Throw a descriptive error when vault-manager returns a non-2xx response.
 */
async function assertOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // Ignore errors when reading the error body.
    }
    throw new Error(
      `vault-manager ${context} failed: HTTP ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class VaultManagerClientImpl implements VaultManagerClient {
  async composeView(req: ComposeViewRequest): Promise<ComposeViewResponse> {
    const { managerEndpoint, managerInternalSecret } =
      await vaultSettingsService.getSettings();

    const url = `${managerEndpoint}/internal/compose-view`;

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...buildCommonHeaders(managerInternalSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
      signal,
    });

    await assertOk(res, 'POST /internal/compose-view');

    return res.json() as Promise<ComposeViewResponse>;
  }

  async proxyGitRequest(opts: {
    method: 'GET' | 'POST';
    path: '/internal/git/info/refs' | '/internal/git/git-upload-pack';
    viewRef: string;
    queryString?: string;
    requestBody?: NodeJS.ReadableStream;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: NodeJS.ReadableStream;
  }> {
    const { managerEndpoint, managerInternalSecret } =
      await vaultSettingsService.getSettings();

    const qs = opts.queryString ? `?${opts.queryString}` : '';
    const url = `${managerEndpoint}${opts.path}${qs}`;

    const headers: Record<string, string> = {
      ...buildCommonHeaders(managerInternalSecret),
      'X-Vault-View-Ref': opts.viewRef,
    };

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    // Forward request body as a stream without buffering.
    // Node.js fetch accepts a ReadableStream (web) or any body type that
    // undici supports. We cast to RequestInit['body'] which accepts
    // ReadableStream and node Readable via undici's internals.
    const fetchOpts: RequestInit = {
      method: opts.method,
      headers,
      signal,
      // @ts-expect-error: Node.js built-in fetch (undici) accepts NodeJS.ReadableStream as body
      body: opts.requestBody ?? undefined,
      // Prevent Node.js fetch from buffering the response body automatically.
      // The duplex option is required when sending a streaming request body.
      ...(opts.requestBody != null ? { duplex: 'half' } : {}),
    };

    const res = await fetch(url, fetchOpts);

    // Collect response headers into a plain object (excludes set-cookie for safety).
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Convert the web ReadableStream response body to a Node.js Readable
    // so callers can pipe it directly to the Express response.
    // We do NOT await the body — streaming begins immediately.
    const webStream = res.body;
    let nodeStream: NodeJS.ReadableStream;
    if (webStream != null) {
      nodeStream = Readable.fromWeb(
        webStream as Parameters<typeof Readable.fromWeb>[0],
      );
    } else {
      // vault-manager returned an empty body (e.g. error with no payload).
      nodeStream = Readable.from([]);
    }

    return {
      status: res.status,
      headers: responseHeaders,
      body: nodeStream,
    };
  }

  async getStorageStats(): Promise<StorageStatsResponse> {
    const { managerEndpoint, managerInternalSecret } =
      await vaultSettingsService.getSettings();

    const url = `${managerEndpoint}/internal/storage-stats`;

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'GET',
      headers: buildCommonHeaders(managerInternalSecret),
      signal,
    });

    await assertOk(res, 'GET /internal/storage-stats');

    return res.json() as Promise<StorageStatsResponse>;
  }
}

/** Singleton instance of VaultManagerClient. */
export const vaultManagerClient: VaultManagerClient =
  new VaultManagerClientImpl();
