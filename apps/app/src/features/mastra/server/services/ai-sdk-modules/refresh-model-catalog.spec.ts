// --- Mock boundary ---------------------------------------------------------
//
// refreshModelCatalog composes three collaborators:
//   - global fetch          : stubbed per test (success / HTTP error / network error)
//   - buildModelCatalog     : REAL — the shared pure transform is the very
//     guarantee under test (same filter/validation as the bundled asset, 9.1)
//   - prisma.mastrarefreshedmodelcatalogs : mocked — persistence is asserted by
//     contract (upserted exactly once on success, NEVER on failure — 9.4)
const { getSingleton, upsertSingleton } = vi.hoisted(() => ({
  getSingleton: vi.fn(),
  upsertSingleton: vi.fn(),
}));

vi.mock('~/utils/prisma', () => ({
  prisma: { mastrarefreshedmodelcatalogs: { getSingleton, upsertSingleton } },
}));

import { mock } from 'vitest-mock-extended';

import { MODELS_DEV_URL } from './build-model-catalog';
import { BUNDLED_CATALOG_GENERATED_AT } from './model-catalog';
import { refreshModelCatalog } from './refresh-model-catalog';

const selectable = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text'], output: ['text'] },
});

const embeddingOutput = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text'], output: ['embedding'] },
});

const provider = (
  id: string,
  models: ReturnType<typeof selectable>[],
): unknown => ({
  id,
  name: id,
  models: Object.fromEntries(models.map((m) => [m.id, m])),
});

const happyFixture = (): unknown => ({
  openai: provider('openai', [selectable('gpt-4o'), selectable('gpt-4.1')]),
  anthropic: provider('anthropic', [selectable('claude-3-7-sonnet')]),
  google: provider('google', [selectable('gemini-2.5-pro')]),
});

const stubFetch = (impl: () => Promise<Response>) => {
  // Typed with fetch's parameter shape so assertions on the called URL
  // (`mock.calls[0][0]`) type-check; the impl itself ignores the arguments.
  const fetchMock = vi.fn(
    (_input: string | URL | Request, _init?: RequestInit) => impl(),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshModelCatalog (Req 9.1, 9.4, 9.7)', () => {
  it('fetches the FIXED models.dev URL, filters with the shared transform, and persists the snapshot (Req 9.1, 9.7)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        mock<Response>({
          ok: true,
          json: () => Promise.resolve(happyFixture()),
        }),
      ),
    );

    const result = await refreshModelCatalog();

    // The target is the built-in constant — callers cannot redirect it (9.7).
    expect(fetchMock.mock.calls[0][0]).toBe(MODELS_DEV_URL);

    // The same generation-time filter/sort as the bundled asset applied (9.1).
    expect(result.models.openai).toEqual(['gpt-4.1', 'gpt-4o']);
    expect(result.fetchedAt).toBeInstanceOf(Date);

    // Persisted exactly once, with the validated snapshot + attribution. The
    // snapshot stamps the CURRENT bundled generation so the newer-wins read
    // compares vendoring-clock timestamps only (never the server clock).
    expect(upsertSingleton).toHaveBeenCalledTimes(1);
    expect(upsertSingleton).toHaveBeenCalledWith({
      models: result.models,
      fetchedAt: result.fetchedAt,
      supersededBundledGeneratedAt: BUNDLED_CATALOG_GENERATED_AT,
      source: expect.stringContaining(MODELS_DEV_URL),
    });
  });

  it('throws and persists NOTHING on an HTTP failure (Req 9.4)', async () => {
    stubFetch(() =>
      Promise.resolve(
        mock<Response>({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        }),
      ),
    );

    await expect(refreshModelCatalog()).rejects.toThrow(/503/);
    expect(upsertSingleton).not.toHaveBeenCalled();
  });

  it('throws and persists NOTHING on a network error (Req 9.4)', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));

    await expect(refreshModelCatalog()).rejects.toThrow();
    expect(upsertSingleton).not.toHaveBeenCalled();
  });

  it('throws and persists NOTHING when a target provider has zero selectable models (Req 9.4)', async () => {
    // Well-formed body, but google is empty after the filter → the shared
    // sanity check throws BEFORE persistence (no silent empty catalog).
    const emptyGoogle = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: provider('google', [embeddingOutput('text-embedding-004')]),
    };
    stubFetch(() =>
      Promise.resolve(
        mock<Response>({ ok: true, json: () => Promise.resolve(emptyGoogle) }),
      ),
    );

    await expect(refreshModelCatalog()).rejects.toThrow(/google/);
    expect(upsertSingleton).not.toHaveBeenCalled();
  });
});
