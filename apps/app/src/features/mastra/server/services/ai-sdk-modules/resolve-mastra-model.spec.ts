// --- Mock boundaries -------------------------------------------------------
//
// The resolver does three things: resolve the effective model id (validated
// against the allow-list), validate the provider, then dispatch to that
// provider's model resolver (now (model) => model). We mock config-manager
// (provider value), resolveEffectiveModelId (the effective model id), and the
// modelResolvers map (so no real @ai-sdk provider is constructed), then observe
// which resolver ran and with which model.
const {
  getConfig,
  resolveEffectiveModelId,
  openaiResolver,
  anthropicResolver,
  googleResolver,
  azureResolver,
} = vi.hoisted(() => ({
  getConfig: vi.fn(),
  resolveEffectiveModelId: vi.fn(),
  // Each resolver returns a fresh object so cache identity (===) is meaningful.
  openaiResolver: vi.fn((modelId: string) => ({
    tag: 'openai-model',
    modelId,
  })),
  anthropicResolver: vi.fn((modelId: string) => ({
    tag: 'anthropic-model',
    modelId,
  })),
  googleResolver: vi.fn((modelId: string) => ({
    tag: 'google-model',
    modelId,
  })),
  azureResolver: vi.fn((modelId: string) => ({ tag: 'azure-model', modelId })),
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

vi.mock('./llm-providers/config', () => ({ resolveEffectiveModelId }));

// Set the configured provider (the only config the resolver itself reads).
const setProvider = (provider: string | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'ai:provider' ? provider : undefined,
  );
};

// Load a FRESH copy so the module-level cache starts empty in every test.
const loadResolver = async (): Promise<
  typeof import('./resolve-mastra-model')
> => {
  vi.resetModules();
  return await import('./resolve-mastra-model');
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the effective model is whatever was requested (identity), so a
  // distinct requested modelId yields a distinct effective model.
  resolveEffectiveModelId.mockImplementation(
    (modelId?: string) => modelId ?? 'default-model',
  );
});

describe('resolveMastraModel', () => {
  describe('provider validation (Req 1.4)', () => {
    it('throws for an out-of-union value (undefined) and dispatches no resolver', async () => {
      setProvider(undefined);
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel('gpt-x')).toThrow(/Unsupported/);
      expect(openaiResolver).not.toHaveBeenCalled();
      expect(anthropicResolver).not.toHaveBeenCalled();
      expect(googleResolver).not.toHaveBeenCalled();
      expect(azureResolver).not.toHaveBeenCalled();
    });

    it('throws for an unsupported provider, surfacing the raw value', async () => {
      setProvider('cohere');
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel('gpt-x')).toThrow(/cohere/);
      expect(openaiResolver).not.toHaveBeenCalled();
    });
  });

  describe('dispatch (Req 1.2 / 4.1)', () => {
    it.each([
      ['openai', openaiResolver, 'openai-model'],
      ['anthropic', anthropicResolver, 'anthropic-model'],
      ['google', googleResolver, 'google-model'],
      ['azure-openai', azureResolver, 'azure-model'],
    ] as const)('dispatches %s to its own model resolver with the effective model', async (provider, resolver, tag) => {
      setProvider(provider);
      resolveEffectiveModelId.mockReturnValue('effective-x');
      const { resolveMastraModel } = await loadResolver();

      const result = resolveMastraModel('requested-x');

      // The client-supplied modelId goes through resolveEffectiveModelId; the
      // provider resolver receives the *effective* model, not the raw request.
      expect(resolveEffectiveModelId).toHaveBeenCalledWith('requested-x');
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith('effective-x');
      expect(result).toMatchObject({ tag, modelId: 'effective-x' });
    });

    it('passes through an omitted modelId to resolveEffectiveModelId', async () => {
      setProvider('openai');
      const { resolveMastraModel } = await loadResolver();

      resolveMastraModel();

      expect(resolveEffectiveModelId).toHaveBeenCalledWith(undefined);
    });
  });

  describe('Map cache (Req 4.1 — same model built once)', () => {
    it('builds the same (provider, model) only once and returns the cached instance', async () => {
      setProvider('openai');
      resolveEffectiveModelId.mockReturnValue('gpt-4');
      const { resolveMastraModel } = await loadResolver();

      const first = resolveMastraModel('gpt-4');
      const second = resolveMastraModel('gpt-4');

      expect(second).toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
    });

    it('caches per effective model: distinct models produce distinct entries, each built once', async () => {
      setProvider('openai');
      // Identity mapping: each requested model is its own effective model.
      const { resolveMastraModel } = await loadResolver();

      const a1 = resolveMastraModel('gpt-4');
      const b1 = resolveMastraModel('gpt-4o');
      const a2 = resolveMastraModel('gpt-4');
      const b2 = resolveMastraModel('gpt-4o');

      expect(a2).toBe(a1);
      expect(b2).toBe(b1);
      expect(a1).not.toBe(b1);
      // One build per distinct effective model, regardless of repeat calls.
      expect(openaiResolver).toHaveBeenCalledTimes(2);
      expect(openaiResolver).toHaveBeenNthCalledWith(1, 'gpt-4');
      expect(openaiResolver).toHaveBeenNthCalledWith(2, 'gpt-4o');
    });

    it('keys by provider+model so two requests collapsing to the same effective model share one build', async () => {
      setProvider('openai');
      // Both an out-of-allowlist request and an omitted request resolve to the
      // same default → one cached build, not two.
      resolveEffectiveModelId.mockReturnValue('gpt-4');
      const { resolveMastraModel } = await loadResolver();

      const fromBogus = resolveMastraModel('bogus');
      const fromOmitted = resolveMastraModel();

      expect(fromOmitted).toBe(fromBogus);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
    });

    it('does not cache failures (re-evaluates after a config fix)', async () => {
      setProvider(undefined);
      const { resolveMastraModel } = await loadResolver();

      expect(() => resolveMastraModel('gpt-4')).toThrow();

      // After the operator fixes config, the next call resolves without a
      // module restart.
      setProvider('openai');
      resolveEffectiveModelId.mockReturnValue('gpt-4');
      expect(resolveMastraModel('gpt-4')).toMatchObject({
        tag: 'openai-model',
      });
    });
  });

  describe('clearResolvedMastraModelCache (Req 1.2 — restart-free reflection)', () => {
    it('clears the whole Map so the next call rebuilds from the latest config', async () => {
      setProvider('openai');
      resolveEffectiveModelId.mockReturnValue('gpt-4');
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      const first = resolveMastraModel('gpt-4');
      expect(resolveMastraModel('gpt-4')).toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(1);

      // Operator saves new settings; clearing forces a fresh build.
      clearResolvedMastraModelCache();
      const rebuilt = resolveMastraModel('gpt-4');

      expect(rebuilt).not.toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(2);
    });

    it('clears entries for every cached model, not just the most recent', async () => {
      setProvider('openai');
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      resolveMastraModel('gpt-4');
      resolveMastraModel('gpt-4o');
      expect(openaiResolver).toHaveBeenCalledTimes(2);

      clearResolvedMastraModelCache();

      resolveMastraModel('gpt-4');
      resolveMastraModel('gpt-4o');
      // Both previously-cached models are rebuilt → +2 builds.
      expect(openaiResolver).toHaveBeenCalledTimes(4);
    });

    it('is a no-op when nothing is cached (safe to call before first resolve)', async () => {
      const { clearResolvedMastraModelCache } = await loadResolver();

      expect(() => clearResolvedMastraModelCache()).not.toThrow();
    });
  });
});
