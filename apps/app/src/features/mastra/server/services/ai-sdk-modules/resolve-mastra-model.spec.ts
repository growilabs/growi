import type { LlmVendor } from '~/features/mastra/interfaces/llm-vendor';
import type { ConfigKey } from '~/server/service/config-manager/config-definition';

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
      // Each factory returns a distinct tagged sentinel so tests can assert the
      // RIGHT vendor's factory produced the model, and that the same instance
      // is reused on memoization.
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

// Single vendor-agnostic config surface: vendor + apiKey + (optional) model.
type ConfigFixture = Partial<Record<ConfigKey, string | undefined>>;

const applyConfig = (fixture: ConfigFixture): void => {
  getConfig.mockImplementation((key: ConfigKey) =>
    key in fixture ? fixture[key] : undefined,
  );
};

// Load a FRESH copy of the module so the module-level memo starts empty in
// every test (the resolved model is memoized at module scope).
const loadResolver = async (): Promise<
  typeof import('./resolve-mastra-model')
> => {
  vi.resetModules();
  return await import('./resolve-mastra-model');
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveMastraModel', () => {
  describe('misconfiguration throws (Req 1.4, 4.1)', () => {
    it('throws for an out-of-union vendor value and builds no provider (Req 1.4)', async () => {
      // `mastra:llmVendor` defaults to 'openai' at the config layer, but env is
      // not runtime-validated against the union, so an out-of-union value must
      // still be rejected here (untrusted env).
      applyConfig({ 'mastra:llmVendor': undefined });
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow(/Unsupported/);
      expect(openaiFactory).not.toHaveBeenCalled();
      expect(anthropicFactory).not.toHaveBeenCalled();
      expect(googleFactory).not.toHaveBeenCalled();
    });

    it('throws for an unsupported vendor, surfacing the raw value (Req 1.4)', async () => {
      applyConfig({ 'mastra:llmVendor': 'azure' });
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow(/azure/);
      expect(openaiFactory).not.toHaveBeenCalled();
    });

    it('throws when the API key is missing (Req 4.1)', async () => {
      applyConfig({
        'mastra:llmVendor': 'openai',
        'mastra:llmApiKey': undefined,
      });
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow(/MASTRA_LLM_API_KEY/);
      expect(openaiFactory).not.toHaveBeenCalled();
    });
  });

  describe('resolves each vendor through its own factory (Req 1.2, 2.1, 2.2)', () => {
    const cases: ReadonlyArray<{
      vendor: LlmVendor;
      apiKey: string;
      model: string;
      factory: typeof openaiFactory;
      tag: string;
    }> = [
      {
        vendor: 'openai',
        apiKey: 'sk-openai-123',
        model: 'gpt-custom',
        factory: openaiFactory,
        tag: 'openai-model',
      },
      {
        vendor: 'anthropic',
        apiKey: 'sk-anthropic-456',
        model: 'claude-custom',
        factory: anthropicFactory,
        tag: 'anthropic-model',
      },
      {
        vendor: 'google',
        apiKey: 'sk-google-789',
        model: 'gemini-custom',
        factory: googleFactory,
        tag: 'google-model',
      },
    ];

    it.each(
      cases,
    )('resolves $vendor with the injected apiKey + model (Req 1.2, 2.1, 2.2)', async ({
      vendor,
      apiKey,
      model,
      factory,
      tag,
    }) => {
      applyConfig({
        'mastra:llmVendor': vendor,
        'mastra:llmApiKey': apiKey,
        'mastra:llmModel': model,
      });
      const { resolveMastraModel } = await loadResolver();

      const resolved = resolveMastraModel();

      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith({ apiKey, model });
      expect(resolved).toMatchObject({ tag, apiKey, model });
    });
  });

  describe('model (Req 2.2, 2.3)', () => {
    it('passes the configured model through to the factory', async () => {
      // The single default (o4-mini, tuned for the default openai vendor) lives
      // in the config defaultValue; the resolver simply forwards getConfig's
      // value — here a custom override.
      applyConfig({
        'mastra:llmVendor': 'openai',
        'mastra:llmApiKey': 'sk-key',
        'mastra:llmModel': 'o4-mini',
      });
      const { resolveMastraModel } = await loadResolver();

      resolveMastraModel();

      expect(openaiFactory).toHaveBeenCalledWith({
        apiKey: 'sk-key',
        model: 'o4-mini',
      });
    });
  });

  describe('single-vendor config surface (Req 3.1, 3.2)', () => {
    it('reads only the single mastra LLM keys, never per-vendor keys', async () => {
      applyConfig({
        'mastra:llmVendor': 'anthropic',
        'mastra:llmApiKey': 'sk-anthropic-456',
      });
      const { resolveMastraModel } = await loadResolver();

      resolveMastraModel();

      const readKeys = getConfig.mock.calls.map(([key]) => key);
      expect(readKeys).toContain('mastra:llmApiKey');
      // No legacy per-vendor key is consulted (one vendor per app).
      expect(readKeys).not.toContain('openai:apiKey');
      expect(readKeys).not.toContain('anthropic:apiKey');
      expect(readKeys).not.toContain('google:apiKey');
    });
  });

  describe('secret safety (Req 2.5)', () => {
    it('never includes the apiKey value in a thrown error message', async () => {
      const secret = 'sk-super-secret-key-value';
      // Vendor invalid -> throw, while a real key is present in config: the
      // message must surface the cause without ever echoing the secret.
      applyConfig({
        'mastra:llmVendor': 'azure',
        'mastra:llmApiKey': secret,
      });
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow();
      try {
        resolveMastraModel();
      } catch (e) {
        expect((e as Error).message).not.toContain(secret);
      }
    });
  });

  describe('memoization (Req 3.1)', () => {
    it('returns the same model instance and builds the provider only once', async () => {
      applyConfig({
        'mastra:llmVendor': 'openai',
        'mastra:llmApiKey': 'sk-openai-123',
        'mastra:llmModel': 'gpt-custom',
      });
      const { resolveMastraModel } = await loadResolver();

      const first = resolveMastraModel();
      const second = resolveMastraModel();

      expect(second).toBe(first);
      expect(openaiFactory).toHaveBeenCalledTimes(1);
    });

    it('does not memoize failures (re-evaluates after a config fix)', async () => {
      applyConfig({ 'mastra:llmVendor': undefined });
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow();

      // After the operator fixes config, the next call resolves without a
      // module restart.
      applyConfig({
        'mastra:llmVendor': 'openai',
        'mastra:llmApiKey': 'sk-openai-123',
      });

      expect(resolveMastraModel()).toMatchObject({ tag: 'openai-model' });
    });
  });
});
