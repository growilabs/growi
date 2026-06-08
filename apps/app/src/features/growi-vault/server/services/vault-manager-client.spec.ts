import { Readable } from 'node:stream';
import type {
  ComposeViewResponse,
  StorageStatsResponse,
} from '@growi/core/dist/interfaces/vault';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports.
// ---------------------------------------------------------------------------

// Mock VaultSettingsService so tests do not need a live MongoDB.
vi.mock('./vault-settings-service', () => ({
  vaultSettingsService: {
    getSettings: vi.fn(),
  },
}));

// Mock the global fetch so tests do not make real network calls.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Lazy imports after mocks are registered.
// ---------------------------------------------------------------------------

const getVaultManagerClient = async () =>
  (await import('./vault-manager-client')).vaultManagerClient;

const getVaultSettingsService = async () =>
  (await import('./vault-settings-service')).vaultSettingsService;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = 'http://vault-manager:3100';
const DEFAULT_SECRET = 'test-shared-secret';

function makeSettings(
  overrides: Partial<{
    managerEndpoint: string;
    managerInternalSecret: string;
  }> = {},
) {
  return {
    enabled: true,
    managerEndpoint: overrides.managerEndpoint ?? DEFAULT_ENDPOINT,
    managerInternalSecret: overrides.managerInternalSecret ?? DEFAULT_SECRET,
  };
}

/**
 * Build a minimal fetch Response mock.
 */
function makeFetchResponse(opts: {
  status?: number;
  ok?: boolean;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  body?: NodeJS.ReadableStream | null;
}): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? status < 400;
  const headerMap = new Map<string, string>(Object.entries(opts.headers ?? {}));

  return {
    status,
    ok,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: vi.fn().mockResolvedValue(opts.json ?? {}),
    text: vi.fn().mockResolvedValue(opts.text ?? ''),
    headers: {
      forEach: (cb: (value: string, key: string) => void) => {
        headerMap.forEach((value, key) => {
          cb(value, key);
        });
      },
      get: (key: string) => headerMap.get(key) ?? null,
    },
    body: opts.body ?? null,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultManagerClient', () => {
  let client: Awaited<ReturnType<typeof getVaultManagerClient>>;
  let settingsService: Awaited<ReturnType<typeof getVaultSettingsService>>;

  beforeEach(async () => {
    client = await getVaultManagerClient();
    settingsService = await getVaultSettingsService();
    vi.mocked(settingsService.getSettings).mockResolvedValue(makeSettings());
    vi.clearAllMocks();
    // Re-apply the default settings mock after clearAllMocks.
    vi.mocked(settingsService.getSettings).mockResolvedValue(makeSettings());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // composeView — happy path
  // -------------------------------------------------------------------------

  describe('composeView', () => {
    it('returns viewRef and commitOid on success', async () => {
      const expectedResponse: ComposeViewResponse = {
        viewRef: 'user-abc-view',
        commitOid: 'deadbeefdeadbeefdeadbeef',
      };

      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ json: expectedResponse }),
      );

      const result = await client.composeView({
        userId: 'user-abc',
        namespaces: ['public', 'group-eng'],
      });

      expect(result).toEqual(expectedResponse);
    });

    it('calls POST /internal/compose-view with correct URL and body', async () => {
      const expectedResponse: ComposeViewResponse = {
        viewRef: 'anonymous-view',
        commitOid: 'cafebabecafebabecafebabe',
      };

      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ json: expectedResponse }),
      );

      await client.composeView({
        userId: null,
        namespaces: ['public'],
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [calledUrl, calledOpts] = mockFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];

      expect(calledUrl).toBe(`${DEFAULT_ENDPOINT}/internal/compose-view`);
      expect(calledOpts.method).toBe('POST');

      // Authorization header must carry the shared secret.
      const authHeader = (calledOpts.headers as Record<string, string>)
        .Authorization;
      expect(authHeader).toBe(`Bearer ${DEFAULT_SECRET}`);

      // Body must contain the serialized request.
      expect(JSON.parse(calledOpts.body as string)).toEqual({
        userId: null,
        namespaces: ['public'],
      });
    });

    it('throws an Error when vault-manager responds with 500', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 500,
          ok: false,
          text: 'internal error',
        }),
      );

      await expect(
        client.composeView({ userId: 'u1', namespaces: [] }),
      ).rejects.toThrow(/vault-manager POST \/internal\/compose-view failed/);
    });

    it('throws an Error when vault-manager responds with 400', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 400,
          ok: false,
          text: 'bad request',
        }),
      );

      await expect(
        client.composeView({ userId: 'u2', namespaces: ['public'] }),
      ).rejects.toThrow(/HTTP 400/);
    });
  });

  // -------------------------------------------------------------------------
  // proxyGitRequest — shared secret header
  // -------------------------------------------------------------------------

  describe('proxyGitRequest — Authorization header', () => {
    it('attaches Authorization: Bearer <secret> to GET info/refs', async () => {
      // Build a minimal web ReadableStream body to simulate a streaming response.
      const bodyContent = Buffer.from('001e# service=git-upload-pack\n');
      const webStream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(bodyContent);
          ctrl.close();
        },
      });

      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 200,
          headers: {
            'content-type': 'application/x-git-upload-pack-advertisement',
          },
          body: webStream as unknown as NodeJS.ReadableStream,
        }),
      );

      const result = await client.proxyGitRequest({
        method: 'GET',
        path: '/internal/git/info/refs',
        viewRef: 'user-abc-view',
        queryString: 'service=git-upload-pack',
      });

      expect(result.status).toBe(200);

      // Verify Authorization and X-Vault-View-Ref headers.
      const [, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const sentHeaders = calledOpts.headers as Record<string, string>;
      expect(sentHeaders.Authorization).toBe(`Bearer ${DEFAULT_SECRET}`);
      expect(sentHeaders['X-Vault-View-Ref']).toBe('user-abc-view');
    });

    it('attaches correct headers to POST git-upload-pack', async () => {
      const webStream = new ReadableStream({
        start(ctrl) {
          ctrl.close();
        },
      });

      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 200,
          body: webStream as unknown as NodeJS.ReadableStream,
        }),
      );

      await client.proxyGitRequest({
        method: 'POST',
        path: '/internal/git/git-upload-pack',
        viewRef: 'user-def-view',
      });

      const [, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const sentHeaders = calledOpts.headers as Record<string, string>;
      expect(sentHeaders.Authorization).toBe(`Bearer ${DEFAULT_SECRET}`);
      expect(sentHeaders['X-Vault-View-Ref']).toBe('user-def-view');
    });
  });

  // -------------------------------------------------------------------------
  // proxyGitRequest — streaming (not buffered)
  // -------------------------------------------------------------------------

  describe('proxyGitRequest — streaming body', () => {
    it('returns a Node.js Readable stream without buffering the response body', async () => {
      const chunk1 = Buffer.from('chunk-one');
      const chunk2 = Buffer.from('chunk-two');

      // Simulate a chunked response from vault-manager.
      const webStream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(chunk1);
          ctrl.enqueue(chunk2);
          ctrl.close();
        },
      });

      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 200,
          body: webStream as unknown as NodeJS.ReadableStream,
        }),
      );

      const result = await client.proxyGitRequest({
        method: 'GET',
        path: '/internal/git/info/refs',
        viewRef: 'some-view',
      });

      // The body must be a Node.js Readable, not a Buffer or string.
      expect(result.body).toBeInstanceOf(Readable);

      // Collect all chunks from the stream to verify data integrity.
      const collected: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        result.body.on('data', (chunk: Buffer) => collected.push(chunk));
        result.body.on('end', resolve);
        result.body.on('error', reject);
      });

      const combined = Buffer.concat(collected).toString();
      expect(combined).toBe('chunk-onechunk-two');
    });

    it('forwards a requestBody stream without buffering it', async () => {
      // Track the value passed as fetch body — it must be the original stream
      // (not a Buffer or string produced by reading the stream first).
      let capturedBody: unknown;
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        capturedBody = opts.body;
        return Promise.resolve(makeFetchResponse({ status: 200, body: null }));
      });

      const inputStream = Readable.from(['want-data']);

      await client.proxyGitRequest({
        method: 'POST',
        path: '/internal/git/git-upload-pack',
        viewRef: 'view-ref-x',
        requestBody: inputStream,
      });

      // The body passed to fetch must be the original Node.js Readable, not a Buffer.
      // This proves we did not buffer the stream before forwarding.
      expect(capturedBody).toBe(inputStream);
    });

    it('uses an empty Readable when vault-manager returns a null body', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ status: 200, body: null }),
      );

      const result = await client.proxyGitRequest({
        method: 'GET',
        path: '/internal/git/info/refs',
        viewRef: 'view-null-body',
      });

      expect(result.body).toBeInstanceOf(Readable);

      // The stream should end immediately with no data.
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        result.body.on('data', (c: Buffer) => chunks.push(c));
        result.body.on('end', resolve);
        result.body.on('error', reject);
      });

      expect(Buffer.concat(chunks).length).toBe(0);
    });

    it('includes the query string in the request URL', async () => {
      const webStream = new ReadableStream({
        start(ctrl) {
          ctrl.close();
        },
      });
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 200,
          body: webStream as unknown as NodeJS.ReadableStream,
        }),
      );

      await client.proxyGitRequest({
        method: 'GET',
        path: '/internal/git/info/refs',
        viewRef: 'v',
        queryString: 'service=git-upload-pack',
      });

      const [calledUrl] = mockFetch.mock.calls[0] as [string];
      expect(calledUrl).toBe(
        `${DEFAULT_ENDPOINT}/internal/git/info/refs?service=git-upload-pack`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getStorageStats — happy path
  // -------------------------------------------------------------------------

  describe('getStorageStats', () => {
    it('returns a StorageStatsResponse on success', async () => {
      const expected: StorageStatsResponse = {
        namespaceCount: 5,
        totalCommitCount: 120,
        looseObjectCount: 3,
        repoSizeBytes: 1_048_576,
        lastSquashAt: '2024-01-15T10:30:00Z',
        lastGcAt: '2024-01-15T11:00:00Z',
      };

      mockFetch.mockResolvedValueOnce(makeFetchResponse({ json: expected }));

      const result = await client.getStorageStats();

      expect(result).toEqual(expected);
    });

    it('calls GET /internal/storage-stats with Authorization header', async () => {
      const stats: StorageStatsResponse = {
        namespaceCount: 0,
        totalCommitCount: 0,
        looseObjectCount: 0,
        repoSizeBytes: 0,
        lastSquashAt: null,
        lastGcAt: null,
      };

      mockFetch.mockResolvedValueOnce(makeFetchResponse({ json: stats }));

      await client.getStorageStats();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [calledUrl, calledOpts] = mockFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];

      expect(calledUrl).toBe(`${DEFAULT_ENDPOINT}/internal/storage-stats`);
      expect(calledOpts.method).toBe('GET');

      const sentHeaders = calledOpts.headers as Record<string, string>;
      expect(sentHeaders.Authorization).toBe(`Bearer ${DEFAULT_SECRET}`);
    });

    it('throws an Error when vault-manager responds with 500', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 500,
          ok: false,
          text: 'storage stats unavailable',
        }),
      );

      await expect(client.getStorageStats()).rejects.toThrow(
        /vault-manager GET \/internal\/storage-stats failed/,
      );
    });

    it('throws an Error when vault-manager responds with 503', async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({
          status: 503,
          ok: false,
          text: 'service unavailable',
        }),
      );

      await expect(client.getStorageStats()).rejects.toThrow(/HTTP 503/);
    });
  });

  // -------------------------------------------------------------------------
  // Settings integration — endpoint and secret are sourced from settings service
  // -------------------------------------------------------------------------

  describe('settings integration', () => {
    it('uses the endpoint from VaultSettingsService', async () => {
      const customEndpoint = 'http://custom-manager:8080';
      vi.mocked(settingsService.getSettings).mockResolvedValue(
        makeSettings({ managerEndpoint: customEndpoint }),
      );

      mockFetch.mockResolvedValueOnce(
        makeFetchResponse({ json: { viewRef: 'v', commitOid: 'abc' } }),
      );

      await client.composeView({ userId: null, namespaces: [] });

      const [calledUrl] = mockFetch.mock.calls[0] as [string];
      expect(calledUrl).toContain(customEndpoint);
    });

    it('uses the secret from VaultSettingsService in the Authorization header', async () => {
      const customSecret = 'super-secret-xyz';
      vi.mocked(settingsService.getSettings).mockResolvedValue(
        makeSettings({ managerInternalSecret: customSecret }),
      );

      const stats: StorageStatsResponse = {
        namespaceCount: 1,
        totalCommitCount: 10,
        looseObjectCount: 0,
        repoSizeBytes: 512,
        lastSquashAt: null,
        lastGcAt: null,
      };
      mockFetch.mockResolvedValueOnce(makeFetchResponse({ json: stats }));

      await client.getStorageStats();

      const [, calledOpts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const sentHeaders = calledOpts.headers as Record<string, string>;
      expect(sentHeaders.Authorization).toBe(`Bearer ${customSecret}`);
    });
  });
});
