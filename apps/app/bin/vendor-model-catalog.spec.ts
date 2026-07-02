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

import { main } from './vendor-model-catalog.ts';

// Intercept the catalog write so the failure-path tests can assert that the
// committed artifact is never overwritten on failure (task 2.2 completion criterion).
const writeFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeFileSync: writeFileSyncMock,
}));

/**
 * A minimal models.dev api.json shaped fixture (the pure transform itself is
 * covered by build-model-catalog.spec.ts next to the shared module; this spec
 * covers only the fetch → validate → write wrapper).
 */
const selectable = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text', 'image'], output: ['text'] },
});

const embeddingOutput = (id: string) => ({
  id,
  name: id,
  tool_call: true,
  modalities: { input: ['text'], output: ['embedding'] },
});

const provider = <T extends { id: string }>(
  id: string,
  models: readonly T[],
): unknown => ({
  id,
  name: id,
  env: [],
  npm: `@ai-sdk/${id}`,
  doc: `https://example.test/${id}`,
  models: Object.fromEntries(models.map((m) => [m.id, m])),
});

const happyFixture = (): unknown => ({
  openai: provider('openai', [selectable('gpt-4o'), selectable('gpt-4.1')]),
  anthropic: provider('anthropic', [selectable('claude-3-7-sonnet')]),
  google: provider('google', [selectable('gemini-2.5-pro')]),
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
