import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { mock } from 'vitest-mock-extended';

import { buildModelCatalog, main } from './vendor-model-catalog.ts';

// Intercept the catalog write so the failure-path tests can assert that the
// committed artifact is never overwritten on failure (task 2.2 completion criterion).
const writeFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeFileSync: writeFileSyncMock,
}));

/**
 * A minimal models.dev api.json shaped fixture. Only the fields the transform
 * reads (`tool_call`, `modalities.output`) are meaningful; everything else is
 * padding to mirror the real, wider entries and to prove passthrough tolerance.
 */
const selectable = (id: string) => ({
  id,
  name: id,
  // extra fields the real api.json carries — must be ignored/passthrough
  family: 'x',
  attachment: false,
  reasoning: false,
  structured_output: true,
  tool_call: true,
  modalities: { input: ['text', 'image'], output: ['text'] },
});

const notToolCall = (id: string) => ({
  id,
  name: id,
  tool_call: false,
  modalities: { input: ['text'], output: ['text'] },
});

const nonTextOutput = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text'], output: ['image'] },
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
  env: [],
  npm: `@ai-sdk/${id}`,
  doc: `https://example.test/${id}`,
  models: Object.fromEntries(models.map((m) => [m.id, m])),
});

const happyFixture = (): unknown => ({
  // an untargeted extra provider (must be ignored entirely)
  azure: provider('azure', [selectable('deployment-x')]),
  openai: provider('openai', [
    selectable('gpt-4o'),
    selectable('gpt-4.1'),
    notToolCall('text-only-no-tools'),
    nonTextOutput('dall-e-3'),
    embeddingOutput('text-embedding-3-large'),
  ]),
  anthropic: provider('anthropic', [
    selectable('claude-3-7-sonnet'),
    selectable('claude-3-5-haiku'),
  ]),
  google: provider('google', [
    selectable('gemini-2.5-pro'),
    embeddingOutput('text-embedding-004'),
  ]),
});

describe('buildModelCatalog', () => {
  it('keeps only selectable (tool_call && text-output) ids, sorted, per provider', () => {
    const catalog = buildModelCatalog(happyFixture());

    // openai: only the two selectable ids survive, sorted; non-selectable absent
    expect(catalog.openai).toEqual(['gpt-4.1', 'gpt-4o']);
    expect(catalog.openai).not.toContain('text-only-no-tools'); // tool_call:false excluded (6.1)
    expect(catalog.openai).not.toContain('dall-e-3'); // non-text output excluded (6.1)
    expect(catalog.openai).not.toContain('text-embedding-3-large'); // embedding excluded (6.1)

    expect(catalog.anthropic).toEqual([
      'claude-3-5-haiku',
      'claude-3-7-sonnet',
    ]);
    expect(catalog.google).toEqual(['gemini-2.5-pro']);
  });

  it('does not include untargeted providers (e.g. azure)', () => {
    const catalog = buildModelCatalog(happyFixture()) as Record<
      string,
      unknown
    >;
    expect(catalog.azure).toBeUndefined();
    expect(Object.keys(catalog)).toEqual(['openai', 'anthropic', 'google']);
  });

  it('is deterministic: scrambled input order yields identical sorted output', () => {
    const base = buildModelCatalog(happyFixture());

    // scramble the model insertion order within openai
    const scrambled = happyFixture() as {
      openai: { models: Record<string, unknown> };
    };
    const entries = Object.entries(scrambled.openai.models).reverse();
    scrambled.openai.models = Object.fromEntries(entries);

    const rebuilt = buildModelCatalog(scrambled as unknown);
    expect(rebuilt).toEqual(base);
  });

  it('throws when a model entry has the wrong shape (schema drift)', () => {
    const malformed = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: {
        id: 'google',
        name: 'google',
        // models is not an object map — drift
        models: [{ id: 'gemini', tool_call: true }],
      },
    };
    expect(() => buildModelCatalog(malformed as unknown)).toThrow();
  });

  it('throws when tool_call has the wrong type (schema drift)', () => {
    const malformed = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      google: {
        id: 'google',
        name: 'google',
        models: {
          gemini: {
            id: 'gemini',
            tool_call: 'yes', // wrong type
            modalities: { output: ['text'] },
          },
        },
      },
    };
    expect(() => buildModelCatalog(malformed as unknown)).toThrow();
  });

  it('throws naming the empty provider when a target provider has zero selectable models', () => {
    const emptyGoogle = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
      // google present but every entry is non-selectable → empty after filter
      google: provider('google', [
        embeddingOutput('text-embedding-004'),
        notToolCall('gemini-embed'),
      ]),
    };
    expect(() => buildModelCatalog(emptyGoogle as unknown)).toThrow(/google/);
  });

  it('throws when a target provider is missing entirely', () => {
    const missingGoogle = {
      openai: provider('openai', [selectable('gpt-4o')]),
      anthropic: provider('anthropic', [selectable('claude')]),
    };
    expect(() => buildModelCatalog(missingGoogle as unknown)).toThrow();
  });
});

// Thrown in place of a real process.exit so a failure halts control flow exactly
// where the process would terminate, while the test can assert the exit happened.
class ProcessExitError extends Error {}

describe('main (fetch → validate → write wrapper)', () => {
  let exitSpy: MockInstance;

  beforeEach(() => {
    writeFileSyncMock.mockClear();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new ProcessExitError();
    });
    // Silence the ingest script's expected stderr/stdout diagnostics.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const stubFetch = (impl: () => Promise<Response>): void => {
    vi.stubGlobal('fetch', vi.fn(impl));
  };

  it('exits non-zero and does not overwrite the catalog on a network error', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));

    await expect(main()).rejects.toBeInstanceOf(ProcessExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('exits non-zero and does not overwrite the catalog on an HTTP failure', async () => {
    stubFetch(() =>
      Promise.resolve(
        mock<Response>({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        }),
      ),
    );

    await expect(main()).rejects.toBeInstanceOf(ProcessExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('exits non-zero and does not overwrite the catalog when a target provider has zero selectable models', async () => {
    // Valid HTTP body, but google has no selectable model → buildModelCatalog throws
    // before any write (Issue 2 sanity check: never ship a silent empty catalog).
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

    await expect(main()).rejects.toBeInstanceOf(ProcessExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('writes the catalog exactly once on a valid response', async () => {
    stubFetch(() =>
      Promise.resolve(
        mock<Response>({
          ok: true,
          json: () => Promise.resolve(happyFixture()),
        }),
      ),
    );

    await main();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const contents = writeFileSyncMock.mock.calls[0][1];
    expect(JSON.parse(contents).models.openai).toContain('gpt-4o');
  });
});
