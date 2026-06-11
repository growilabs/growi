// --- Mock boundaries -------------------------------------------------------
//
// The resolver does two things: validate the provider, then dispatch to that
// provider's self-contained model resolver (uniform () => model). We mock
// config-manager (provider value) and the modelResolvers map (so no real @ai-sdk
// provider is constructed) and observe which resolver ran.
const {
  getConfig,
  openaiResolver,
  anthropicResolver,
  googleResolver,
  azureResolver,
} = vi.hoisted(() => ({
  getConfig: vi.fn(),
  openaiResolver: vi.fn(() => ({ tag: 'openai-model' })),
  anthropicResolver: vi.fn(() => ({ tag: 'anthropic-model' })),
  googleResolver: vi.fn(() => ({ tag: 'google-model' })),
  azureResolver: vi.fn(() => ({ tag: 'azure-model' })),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('./llm-providers', () => ({
  modelResolvers: {
    openai: openaiResolver,
    anthropic: anthropicResolver,
    google: googleResolver,
    'azure-openai': azureResolver,
  },
}));

// Set the configured provider (the only config the resolver itself reads).
const setProvider = (provider: string | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'mastra:llmProvider' ? provider : undefined,
  );
};

// Load a FRESH copy so the module-level memo starts empty in every test.
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
  describe('provider validation (Req 1.4)', () => {
    it('throws for an out-of-union value (undefined) and dispatches no resolver', async () => {
      setProvider(undefined);
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow(/Unsupported/);
      expect(openaiResolver).not.toHaveBeenCalled();
      expect(anthropicResolver).not.toHaveBeenCalled();
      expect(googleResolver).not.toHaveBeenCalled();
      expect(azureResolver).not.toHaveBeenCalled();
    });

    it('throws for an unsupported provider, surfacing the raw value', async () => {
      setProvider('cohere');
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow(/cohere/);
      expect(openaiResolver).not.toHaveBeenCalled();
    });
  });

  describe('dispatch (Req 1.2)', () => {
    it.each([
      ['openai', openaiResolver, 'openai-model'],
      ['anthropic', anthropicResolver, 'anthropic-model'],
      ['google', googleResolver, 'google-model'],
      ['azure-openai', azureResolver, 'azure-model'],
    ] as const)('dispatches %s to its own model resolver', async (provider, resolver, tag) => {
      setProvider(provider);
      const { resolveMastraModel } = await loadResolver();

      const result = resolveMastraModel();

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ tag });
    });
  });

  describe('memoization (Req 3.1)', () => {
    it('returns the same instance and resolves only once', async () => {
      setProvider('openai');
      const { resolveMastraModel } = await loadResolver();

      const first = resolveMastraModel();
      const second = resolveMastraModel();

      expect(second).toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
    });

    it('does not memoize failures (re-evaluates after a config fix)', async () => {
      setProvider(undefined);
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel()).toThrow();

      // After the operator fixes config, the next call resolves without a
      // module restart.
      setProvider('openai');
      expect(resolveMastraModel()).toMatchObject({ tag: 'openai-model' });
    });
  });
});
