import type { LanguageModel } from 'ai';

import type { LlmVendor } from '~/features/mastra/interfaces/llm-vendor';
import type { ConfigKey } from '~/server/service/config-manager/config-definition';

import type { MastraModelResolution } from './resolve-mastra-model';

// --- Mock boundaries -------------------------------------------------------
//
// We mock the two external collaborators of the resolver:
//   1. config-manager — so getConfig(key) returns per-test fixture values.
//   2. ./llm-providers — so no real @ai-sdk provider is constructed; we observe
//      which factory ran and with what { apiKey, model }.
//
// vi.hoisted keeps the spies available inside the hoisted vi.mock factories.
const { getConfig, openaiFactory, anthropicFactory, googleFactory } =
  vi.hoisted(() => {
    return {
      getConfig: vi.fn(),
      // Each factory returns a distinct tagged sentinel so tests can assert
      // the RIGHT vendor's factory produced the model, and that the same
      // instance is reused on memoization.
      openaiFactory: vi.fn((params: { apiKey: string; model: string }) => ({
        tag: 'openai-model',
        ...params,
      })),
      anthropicFactory: vi.fn((params: { apiKey: string; model: string }) => ({
        tag: 'anthropic-model',
        ...params,
      })),
      googleFactory: vi.fn((params: { apiKey: string; model: string }) => ({
        tag: 'google-model',
        ...params,
      })),
    };
  });

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('./llm-providers', () => ({
  llmModelFactories: {
    openai: openaiFactory,
    anthropic: anthropicFactory,
    google: googleFactory,
  },
}));

// Fixture for the configManager.getConfig mock. A partial record keyed by the
// config keys the resolver reads; getConfig falls through to the declared
// per-vendor model defaults when a model key is absent (mirroring the real
// config-definition defaults so the "model unset -> default" branch is real).
const MODEL_DEFAULTS: Partial<Record<ConfigKey, string>> = {
  'openai:assistantModel:mastraAgent': 'o4-mini',
  'anthropic:assistantModel:mastraAgent': 'claude-sonnet-4-5',
  'google:assistantModel:mastraAgent': 'gemini-2.5-flash',
};

type ConfigFixture = Partial<Record<ConfigKey, string | undefined>>;

const applyConfig = (fixture: ConfigFixture): void => {
  getConfig.mockImplementation((key: ConfigKey) => {
    if (key in fixture) return fixture[key];
    // Unset model keys resolve to their declared defaults.
    if (key in MODEL_DEFAULTS) return MODEL_DEFAULTS[key];
    return undefined;
  });
};

// Load a FRESH copy of the module so the module-level memo starts empty in
// every test (the ok result is memoized at module scope).
const loadResolver = async (): Promise<
  typeof import('./resolve-mastra-model')
> => {
  vi.resetModules();
  return await import('./resolve-mastra-model');
};

// Narrowing helper: assert ok status and return the narrowed resolution
// without a cast (the discriminant collapses the union).
const expectOk = (
  resolution: MastraModelResolution,
): Extract<MastraModelResolution, { status: 'ok' }> => {
  expect(resolution.status).toBe('ok');
  if (resolution.status !== 'ok') {
    throw new Error('expected ok resolution');
  }
  return resolution;
};

const expectDisabled = (
  resolution: MastraModelResolution,
): Extract<MastraModelResolution, { status: 'disabled' }> => {
  expect(resolution.status).toBe('disabled');
  if (resolution.status !== 'disabled') {
    throw new Error('expected disabled resolution');
  }
  return resolution;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveMastraModel', () => {
  describe('disabled branches', () => {
    it('returns disabled vendor-unset when the vendor is null (Req 1.3, 4.1)', async () => {
      applyConfig({ 'mastra:llmVendor': undefined });
      const { resolveMastraModel } = await loadResolver();

      const resolution = resolveMastraModel();

      const { reason } = expectDisabled(resolution);
      expect(reason).toEqual({ type: 'vendor-unset' });
      // No fallback to a default vendor: no factory is constructed.
      expect(openaiFactory).not.toHaveBeenCalled();
      expect(anthropicFactory).not.toHaveBeenCalled();
      expect(googleFactory).not.toHaveBeenCalled();
    });

    it('returns disabled vendor-invalid carrying the raw env string (Req 1.4)', async () => {
      applyConfig({ 'mastra:llmVendor': 'azure' });
      const { resolveMastraModel } = await loadResolver();

      const resolution = resolveMastraModel();

      const { reason } = expectDisabled(resolution);
      expect(reason).toEqual({ type: 'vendor-invalid', value: 'azure' });
      expect(openaiFactory).not.toHaveBeenCalled();
    });

    it('returns disabled api-key-missing for the selected vendor (Req 4.1)', async () => {
      applyConfig({
        'mastra:llmVendor': 'openai',
        'openai:apiKey': undefined,
      });
      const { resolveMastraModel } = await loadResolver();

      const resolution = resolveMastraModel();

      const { reason } = expectDisabled(resolution);
      expect(reason).toEqual({ type: 'api-key-missing', vendor: 'openai' });
      expect(openaiFactory).not.toHaveBeenCalled();
    });
  });

  describe('ok branches — each vendor resolves via its own factory', () => {
    const cases: ReadonlyArray<{
      vendor: LlmVendor;
      apiKeyConfig: ConfigKey;
      apiKey: string;
      model: string;
      modelConfig: ConfigKey;
      factory: typeof openaiFactory;
      tag: string;
    }> = [
      {
        vendor: 'openai',
        apiKeyConfig: 'openai:apiKey',
        apiKey: 'sk-openai-123',
        model: 'gpt-custom',
        modelConfig: 'openai:assistantModel:mastraAgent',
        factory: openaiFactory,
        tag: 'openai-model',
      },
      {
        vendor: 'anthropic',
        apiKeyConfig: 'anthropic:apiKey',
        apiKey: 'sk-anthropic-456',
        model: 'claude-custom',
        modelConfig: 'anthropic:assistantModel:mastraAgent',
        factory: anthropicFactory,
        tag: 'anthropic-model',
      },
      {
        vendor: 'google',
        apiKeyConfig: 'google:apiKey',
        apiKey: 'sk-google-789',
        model: 'gemini-custom',
        modelConfig: 'google:assistantModel:mastraAgent',
        factory: googleFactory,
        tag: 'google-model',
      },
    ];

    it.each(
      cases,
    )('resolves $vendor through its factory with that vendor apiKey + model (Req 1.2, 2.1)', async ({
      vendor,
      apiKeyConfig,
      apiKey,
      model,
      modelConfig,
      factory,
      tag,
    }) => {
      applyConfig({
        'mastra:llmVendor': vendor,
        [apiKeyConfig]: apiKey,
        [modelConfig]: model,
      });
      const { resolveMastraModel } = await loadResolver();

      const resolution = resolveMastraModel();

      const ok = expectOk(resolution);
      expect(ok.vendor).toBe(vendor);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith({ apiKey, model });
      expect(ok.model).toMatchObject({ tag, apiKey, model });
    });
  });

  describe('model default (Req 2.3)', () => {
    it('uses the vendor default model when the model config is unset', async () => {
      applyConfig({
        'mastra:llmVendor': 'anthropic',
        'anthropic:apiKey': 'sk-anthropic-456',
        // anthropic:assistantModel:mastraAgent intentionally omitted -> default
      });
      const { resolveMastraModel } = await loadResolver();

      resolveMastraModel();

      expect(anthropicFactory).toHaveBeenCalledWith({
        apiKey: 'sk-anthropic-456',
        model: 'claude-sonnet-4-5',
      });
    });
  });

  describe('single-vendor key isolation (Req 3.2)', () => {
    it('reads ONLY the selected vendor key; resolves even when other vendors keys are absent', async () => {
      applyConfig({
        'mastra:llmVendor': 'anthropic',
        'anthropic:apiKey': 'sk-anthropic-456',
        // openai:apiKey and google:apiKey are absent.
      });
      const { resolveMastraModel } = await loadResolver();

      const resolution = resolveMastraModel();

      expectOk(resolution);
      // The resolver must never read another vendor's apiKey.
      const readKeys = getConfig.mock.calls.map(([key]) => key);
      expect(readKeys).not.toContain('openai:apiKey');
      expect(readKeys).not.toContain('google:apiKey');
      expect(readKeys).not.toContain('openai:assistantModel:mastraAgent');
      expect(readKeys).not.toContain('google:assistantModel:mastraAgent');
    });
  });

  describe('secret safety (Req 2.5)', () => {
    it('never includes the apiKey value anywhere in a disabled reason', async () => {
      const secret = 'sk-super-secret-key-value';
      // api-key-missing is the only disabled branch reached with a vendor whose
      // key we might mistakenly echo; verify the secret never leaks even when
      // present in config for a DIFFERENT key.
      applyConfig({
        'mastra:llmVendor': 'azure',
        // A stray secret somewhere in config must never surface in the reason.
        'openai:apiKey': secret,
      });
      const { resolveMastraModel } = await loadResolver();

      const { reason } = expectDisabled(resolveMastraModel());

      expect(JSON.stringify(reason)).not.toContain(secret);
    });

    it('api-key-missing reason contains only type and vendor (no key field)', async () => {
      applyConfig({
        'mastra:llmVendor': 'openai',
        'openai:apiKey': undefined,
      });
      const { resolveMastraModel } = await loadResolver();

      const { reason } = expectDisabled(resolveMastraModel());

      expect(reason).toEqual({ type: 'api-key-missing', vendor: 'openai' });
      expect(Object.keys(reason)).toEqual(['type', 'vendor']);
    });
  });

  describe('memoization of ok result (Req 3.1)', () => {
    it('returns the same model instance and builds the provider only once across calls', async () => {
      applyConfig({
        'mastra:llmVendor': 'openai',
        'openai:apiKey': 'sk-openai-123',
        'openai:assistantModel:mastraAgent': 'gpt-custom',
      });
      const { resolveMastraModel } = await loadResolver();

      const first = expectOk(resolveMastraModel());
      const second = expectOk(resolveMastraModel());

      expect(second.model).toBe(first.model);
      expect(openaiFactory).toHaveBeenCalledTimes(1);
    });

    it('does not memoize disabled results (re-evaluates on each call)', async () => {
      applyConfig({ 'mastra:llmVendor': undefined });
      const { resolveMastraModel } = await loadResolver();

      expectDisabled(resolveMastraModel());

      // After the operator fixes config, the next call should resolve to ok
      // without requiring a restart of the resolver module.
      applyConfig({
        'mastra:llmVendor': 'openai',
        'openai:apiKey': 'sk-openai-123',
      });

      const second = expectOk(resolveMastraModel());
      expect(second.vendor).toBe('openai');
    });
  });
});

// Type-level guard: the returned model is assignable to LanguageModel via the
// factory contract. This line type-checks the public surface; it never runs.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typecheckModel = (
  r: MastraModelResolution,
): LanguageModel | undefined => (r.status === 'ok' ? r.model : undefined);
