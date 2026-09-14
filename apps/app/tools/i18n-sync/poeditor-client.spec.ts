// Mock the global fetch so tests do not make real network calls
// (same pattern as vault-manager-client.spec.ts).
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createPoeditorClient, type PoeditorApiError } from './poeditor-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (status: number, body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const API_TOKEN = 'test-api-token';
const PROJECT_ID = '123456';

describe('createPoeditorClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('uploadTerms', () => {
    it('resolves ok on a successful upload', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, { result: { terms: { parsed: 1 } } }),
      );
      const sleep = vi.fn().mockResolvedValue(undefined);
      const client = createPoeditorClient({ apiToken: API_TOKEN, sleep });

      const result = await client.uploadTerms({
        projectId: PROJECT_ID,
        language: 'en_US',
        fileContent: '{"key":"value"}',
      });

      expect(result.ok).toBe(true);

      // The request must be a multipart/form-data upload carrying the file,
      // and must never embed the token as a literal value anywhere other
      // than the parameter it was injected through.
      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('POST');
      const sentBody = init.body as FormData;
      expect(sentBody instanceof FormData).toBe(true);
      expect(sentBody.get('id')).toBe(PROJECT_ID);
      expect(sentBody.get('language')).toBe('en_US');
      expect(sentBody.get('updating')).toBe('terms_translations');
      expect(sentBody.get('sync_terms')).toBe('1');
      expect(sentBody.get('api_token')).toBe(API_TOKEN);
    });

    it('maps a 429 response to a rate_limited error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(429, { response: {} }));
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.uploadTerms({
        projectId: PROJECT_ID,
        language: 'en_US',
        fileContent: '{}',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({
          type: 'rate_limited',
        });
      }
    });

    it('maps a 400 response to an invalid_request error carrying a message', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(400, {
          response: { message: 'Invalid file contents' },
        }),
      );
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.uploadTerms({
        projectId: PROJECT_ID,
        language: 'en_US',
        fileContent: 'not json',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({
          type: 'invalid_request',
          message: 'Invalid file contents',
        });
      }
    });

    it('maps a 404 response to a not_found error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(404, { response: {} }));
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.uploadTerms({
        projectId: PROJECT_ID,
        language: 'en_US',
        fileContent: '{}',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({ type: 'not_found' });
      }
    });

    it('maps a thrown fetch error to a network_error result carrying the cause', async () => {
      const cause = new Error('ECONNRESET');
      mockFetch.mockRejectedValueOnce(cause);
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.uploadTerms({
        projectId: PROJECT_ID,
        language: 'en_US',
        fileContent: '{}',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({
          type: 'network_error',
          cause,
        });
      }
    });

    it('waits at least 20 seconds between consecutive upload calls (fakeable via injected sleep)', async () => {
      // The throttle computes the remaining wait from real Date.now() deltas
      // (see throttleUpload in poeditor-client.ts), so measuring it against
      // the real clock is inherently subject to sub-millisecond scheduling
      // jitter between the two awaited uploadTerms() calls below — this is
      // what made the test intermittently fail with e.g. "19999 to be
      // greater than or equal to 20000". Freezing the clock with fake timers
      // removes that jitter entirely:
      // Date.now() returns the same value for both calls, so the elapsed
      // time between them is exactly 0 and the computed remaining wait is
      // deterministically 20000, every run.
      vi.useFakeTimers();
      try {
        mockFetch.mockResolvedValue(jsonResponse(200, { result: {} }));
        const sleep = vi.fn().mockResolvedValue(undefined);
        const client = createPoeditorClient({ apiToken: API_TOKEN, sleep });

        await client.uploadTerms({
          projectId: PROJECT_ID,
          language: 'en_US',
          fileContent: '{}',
        });
        // The first call must not wait (no prior call to throttle against).
        expect(sleep).not.toHaveBeenCalled();

        await client.uploadTerms({
          projectId: PROJECT_ID,
          language: 'en_US',
          fileContent: '{}',
        });
        // The second call must wait at least 20 seconds since the first.
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(20_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not read the API token from process.env', async () => {
      const original = process.env.POEDITOR_API_TOKEN;
      process.env.POEDITOR_API_TOKEN = 'env-token-should-not-be-used';
      try {
        mockFetch.mockResolvedValueOnce(jsonResponse(200, { result: {} }));
        const client = createPoeditorClient({
          apiToken: API_TOKEN,
          sleep: vi.fn().mockResolvedValue(undefined),
        });

        await client.uploadTerms({
          projectId: PROJECT_ID,
          language: 'en_US',
          fileContent: '{}',
        });

        const [, init] = mockFetch.mock.calls[0];
        const sentBody = init.body as FormData;
        expect(sentBody.get('api_token')).toBe(API_TOKEN);
        expect(sentBody.get('api_token')).not.toBe(
          'env-token-should-not-be-used',
        );
      } finally {
        process.env.POEDITOR_API_TOKEN = original;
      }
    });
  });

  describe('exportTranslations', () => {
    it('resolves the downloaded file content on success', async () => {
      const downloadUrl = 'https://poeditor.com/download/abc123';
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(200, { result: { url: downloadUrl } }),
        )
        .mockResolvedValueOnce(new Response('{"key":"translated value"}'));
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.exportTranslations({
        projectId: PROJECT_ID,
        language: 'ja_JP',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('{"key":"translated value"}');
      }
      // Second fetch call must be the download itself.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(downloadUrl);
    });

    it('maps a 404 response to a not_found error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(404, { response: {} }));
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.exportTranslations({
        projectId: PROJECT_ID,
        language: 'xx_XX',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({ type: 'not_found' });
      }
    });

    it('maps a thrown fetch error to a network_error result', async () => {
      const cause = new Error('timeout');
      mockFetch.mockRejectedValueOnce(cause);
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.exportTranslations({
        projectId: PROJECT_ID,
        language: 'ja_JP',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({
          type: 'network_error',
          cause,
        });
      }
    });
  });

  describe('listLanguages', () => {
    it('resolves the language list on success', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, {
          result: {
            languages: [
              { code: 'ja_JP', percentage: 42 },
              { code: 'fr_FR', percentage: 0 },
            ],
          },
        }),
      );
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.listLanguages({ projectId: PROJECT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([
          { code: 'ja_JP', percentage: 42 },
          { code: 'fr_FR', percentage: 0 },
        ]);
      }
    });

    it('maps a 429 response to a rate_limited error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(429, { response: {} }));
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.listLanguages({ projectId: PROJECT_ID });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({
          type: 'rate_limited',
        });
      }
    });

    it('maps a 400 response to an invalid_request error', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(400, { response: { message: 'Invalid project id' } }),
      );
      const client = createPoeditorClient({
        apiToken: API_TOKEN,
        sleep: vi.fn().mockResolvedValue(undefined),
      });

      const result = await client.listLanguages({ projectId: PROJECT_ID });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual<PoeditorApiError>({
          type: 'invalid_request',
          message: 'Invalid project id',
        });
      }
    });
  });
});
