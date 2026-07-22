// --- Mock boundaries -------------------------------------------------------
//
// resolveMastraModel now: resolves the effective modelKey (the single allow-list
// checkpoint), parses it into (provider, modelId), dispatches to THAT provider's
// resolver with the BARE modelId, and caches the IN-FLIGHT build Promise keyed
// by the effective modelKey (single-flight: concurrent misses share one build,
// and clearing mid-build discards the pending entry). We mock the effective-key
// checkpoint and the modelResolvers map (so no real @ai-sdk provider is
// constructed), then observe which resolver ran and with which modelId.
// parseModelKey is the real pure function (not mocked), so dispatch is driven by
// genuine key parsing.
const {
  resolveEffectiveModelKey,
  openaiResolver,
  anthropicResolver,
  googleResolver,
  azureResolver,
} = vi.hoisted(() => ({
  resolveEffectiveModelKey: vi.fn(),
  // Each resolver is async — mirroring the real resolvers, which lazily import
  // their provider SDK and so always return a Promise (misconfiguration
  // surfaces as a rejection, never a sync throw) — and resolves to a fresh
  // object so cache identity (===) is meaningful.
  openaiResolver: vi.fn(async (modelId: string) => ({
    tag: 'openai-model',
    modelId,
  })),
  anthropicResolver: vi.fn(async (modelId: string) => ({
    tag: 'anthropic-model',
    modelId,
  })),
  googleResolver: vi.fn(async (modelId: string) => ({
    tag: 'google-model',
    modelId,
  })),
  azureResolver: vi.fn(async (modelId: string) => ({
    tag: 'azure-model',
    modelId,
  })),
}));

vi.mock('./llm-providers', () => ({
  modelResolvers: {
    openai: openaiResolver,
    anthropic: anthropicResolver,
    google: googleResolver,
    'azure-openai': azureResolver,
  },
}));

vi.mock('./llm-providers/effective-model-key', () => ({
  resolveEffectiveModelKey,
}));

// Load a FRESH copy so the module-level cache starts empty in every test.
// The cache storage lives in './resolved-model-cache' (kept import-light so
// boot-path consumers can clear it without pulling the provider graph); load
// both from the same fresh registry so resolver and cache stay paired.
const loadResolver = async (): Promise<
  typeof import('./resolve-mastra-model') &
    typeof import('./resolved-model-cache')
> => {
  vi.resetModules();
  const [resolver, cache] = await Promise.all([
    import('./resolve-mastra-model'),
    import('./resolved-model-cache'),
  ]);
  return { ...resolver, ...cache };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: identity — the requested key IS the effective key.
  resolveEffectiveModelKey.mockImplementation(
    (modelKey?: string) => modelKey ?? 'openai/default-model',
  );
});

describe('resolveMastraModel', () => {
  describe('dispatch by parsed provider (Req 4.3)', () => {
    it.each([
      ['openai/gpt-5', openaiResolver, 'openai-model', 'gpt-5'],
      ['anthropic/claude-x', anthropicResolver, 'anthropic-model', 'claude-x'],
      ['google/gemini-x', googleResolver, 'google-model', 'gemini-x'],
      ['azure-openai/my-deploy', azureResolver, 'azure-model', 'my-deploy'],
    ] as const)('dispatches %s to its own provider resolver with the bare modelId', async (key, resolver, tag, modelId) => {
      resolveEffectiveModelKey.mockReturnValue(key);
      const { resolveMastraModel } = await loadResolver();

      const result = await resolveMastraModel('requested-key');

      // The client-supplied key goes through the effective-key checkpoint; the
      // provider resolver receives the *bare* modelId parsed from the effective
      // key, not the composite key.
      expect(resolveEffectiveModelKey).toHaveBeenCalledWith('requested-key');
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith(modelId);
      expect(result).toMatchObject({ tag, modelId });
    });

    it('dispatches by PROVIDER, not modelId: the same modelId under two providers routes to different resolvers (Req 4.3)', async () => {
      const { resolveMastraModel } = await loadResolver();

      resolveEffectiveModelKey.mockReturnValueOnce('openai/gpt-5');
      const openaiResult = await resolveMastraModel('openai/gpt-5');
      resolveEffectiveModelKey.mockReturnValueOnce('anthropic/gpt-5');
      const anthropicResult = await resolveMastraModel('anthropic/gpt-5');

      // Same modelId ('gpt-5'), different provider prefix → different resolvers.
      // Keying dispatch on modelId alone (the old single-provider behavior) would
      // have routed both to the same resolver — this is the regression guard.
      expect(openaiResolver).toHaveBeenCalledWith('gpt-5');
      expect(anthropicResolver).toHaveBeenCalledWith('gpt-5');
      expect(openaiResult).toMatchObject({ tag: 'openai-model' });
      expect(anthropicResult).toMatchObject({ tag: 'anthropic-model' });
    });

    it('passes an omitted modelKey through to the effective-key checkpoint', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-5');
      const { resolveMastraModel } = await loadResolver();

      await resolveMastraModel();

      expect(resolveEffectiveModelKey).toHaveBeenCalledWith(undefined);
    });

    it('splits on the FIRST separator, so a modelId that itself contains "/" is preserved', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/org/model-x');
      const { resolveMastraModel } = await loadResolver();

      await resolveMastraModel('openai/org/model-x');

      expect(openaiResolver).toHaveBeenCalledWith('org/model-x');
    });

    it('throws (and dispatches no resolver) when the effective key is unparseable (defensive)', async () => {
      // getEffectiveDefaultModelKey / resolveEffectiveModelKey always return a
      // built key, so an unparseable effective key is a should-never-happen
      // defense; if it ever occurs the resolver must throw rather than dispatch
      // on an undefined provider.
      resolveEffectiveModelKey.mockReturnValue('no-separator');
      const { resolveMastraModel } = await loadResolver();

      await expect(resolveMastraModel('x')).rejects.toThrow();
      expect(openaiResolver).not.toHaveBeenCalled();
      expect(anthropicResolver).not.toHaveBeenCalled();
      expect(googleResolver).not.toHaveBeenCalled();
      expect(azureResolver).not.toHaveBeenCalled();
    });
  });

  describe('cache keyed by the effective modelKey (Req 4.3 — built once per key)', () => {
    it('builds the same effective key only once and returns the cached instance', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel } = await loadResolver();

      const first = await resolveMastraModel('openai/gpt-4');
      const second = await resolveMastraModel('openai/gpt-4');

      expect(second).toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
    });

    it('caches per effective key: distinct keys build separately, each built once', async () => {
      // Identity mapping (beforeEach): each requested key is its own effective key.
      const { resolveMastraModel } = await loadResolver();

      const a1 = await resolveMastraModel('openai/gpt-4');
      const b1 = await resolveMastraModel('anthropic/claude');
      const a2 = await resolveMastraModel('openai/gpt-4');
      const b2 = await resolveMastraModel('anthropic/claude');

      expect(a2).toBe(a1);
      expect(b2).toBe(b1);
      expect(a1).not.toBe(b1);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
      expect(anthropicResolver).toHaveBeenCalledTimes(1);
    });

    it('keys by the EFFECTIVE key, so two requests collapsing to the same default share one build', async () => {
      // Both an out-of-allowlist key and an omitted key resolve to the same
      // effective default → one cached build, not two.
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel } = await loadResolver();

      const fromBogus = await resolveMastraModel('openai/bogus');
      const fromOmitted = await resolveMastraModel();

      expect(fromOmitted).toBe(fromBogus);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
    });

    it('does not cache a resolver failure (re-evaluates after a config fix)', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel } = await loadResolver();

      // The provider resolver rejects (e.g. missing api key) on the first
      // attempt — the real resolvers are async, so misconfiguration surfaces as
      // a rejection. The failed build must be evicted, not served from cache.
      openaiResolver.mockRejectedValueOnce(new Error('missing key'));
      await expect(resolveMastraModel('openai/gpt-4')).rejects.toThrow();

      // After the operator fixes config, the next call rebuilds (nothing cached)
      // without a module restart.
      const rebuilt = await resolveMastraModel('openai/gpt-4');
      expect(rebuilt).toMatchObject({ tag: 'openai-model' });
      expect(openaiResolver).toHaveBeenCalledTimes(2);
    });

    it('does not cache (and dispatches nothing) when the effective-key checkpoint throws', async () => {
      resolveEffectiveModelKey.mockImplementation(() => {
        throw new Error('No available AI model');
      });
      const { resolveMastraModel } = await loadResolver();

      await expect(resolveMastraModel('openai/gpt-4')).rejects.toThrow(
        /No available/,
      );
      expect(openaiResolver).not.toHaveBeenCalled();
    });
  });

  describe('single-flight caching under concurrency (in-flight Promise is the cache entry)', () => {
    it('concurrent requests for the same key share ONE build (no duplicate construction)', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel } = await loadResolver();

      // Neither call awaits the other — both are dispatched while the build is
      // in flight, the shape of a first-request burst after boot / cache clear.
      const [first, second] = await Promise.all([
        resolveMastraModel('openai/gpt-4'),
        resolveMastraModel('openai/gpt-4'),
      ]);

      expect(second).toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(1);
    });

    it('a build in flight when the cache is cleared cannot repopulate it (no stale model after a settings save)', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      // A build whose completion the test controls: started before the clear,
      // finishing after it — the shape of "admin saves settings mid-build".
      let finishStaleBuild!: (model: { tag: string; modelId: string }) => void;
      openaiResolver.mockImplementationOnce(
        () =>
          new Promise<{ tag: string; modelId: string }>((resolve) => {
            finishStaleBuild = resolve;
          }),
      );

      const staleBuild = resolveMastraModel('openai/gpt-4');
      clearResolvedMastraModelCache();
      finishStaleBuild({
        tag: 'openai-model',
        modelId: 'built-from-old-config',
      });
      // The request that started the build still gets the model it began
      // building (it predates the config change)...
      await expect(staleBuild).resolves.toMatchObject({
        modelId: 'built-from-old-config',
      });

      // ...but that stale model must NOT be served to later requests: the next
      // call rebuilds from the post-save config.
      const rebuilt = await resolveMastraModel('openai/gpt-4');
      expect(rebuilt).toMatchObject({ modelId: 'gpt-4' });
      expect(openaiResolver).toHaveBeenCalledTimes(2);
    });

    it('a late failure of a superseded build does not evict the fresh rebuild', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      let failStaleBuild!: (err: Error) => void;
      openaiResolver.mockImplementationOnce(
        () =>
          new Promise<{ tag: string; modelId: string }>((_resolve, reject) => {
            failStaleBuild = reject;
          }),
      );

      const staleBuild = resolveMastraModel('openai/gpt-4');
      clearResolvedMastraModelCache();
      // Config is fixed and a fresh build succeeds while the old one is pending.
      const rebuilt = await resolveMastraModel('openai/gpt-4');

      // The superseded build now fails; evict-on-rejection must leave the fresh
      // entry alone (it only removes the entry it belongs to).
      failStaleBuild(new Error('stale failure'));
      await expect(staleBuild).rejects.toThrow('stale failure');

      expect(await resolveMastraModel('openai/gpt-4')).toBe(rebuilt);
      expect(openaiResolver).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearResolvedMastraModelCache (Req — restart-free reflection)', () => {
    it('clears the whole Map so the next call rebuilds from the latest config', async () => {
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      const first = await resolveMastraModel('openai/gpt-4');
      expect(await resolveMastraModel('openai/gpt-4')).toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(1);

      // Operator saves new settings; clearing forces a fresh build.
      clearResolvedMastraModelCache();
      const rebuilt = await resolveMastraModel('openai/gpt-4');

      expect(rebuilt).not.toBe(first);
      expect(openaiResolver).toHaveBeenCalledTimes(2);
    });

    it('clears entries for every cached key, not just the most recent', async () => {
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      await resolveMastraModel('openai/gpt-4');
      await resolveMastraModel('anthropic/claude');
      expect(openaiResolver).toHaveBeenCalledTimes(1);
      expect(anthropicResolver).toHaveBeenCalledTimes(1);

      clearResolvedMastraModelCache();

      await resolveMastraModel('openai/gpt-4');
      await resolveMastraModel('anthropic/claude');
      // Both previously-cached keys are rebuilt.
      expect(openaiResolver).toHaveBeenCalledTimes(2);
      expect(anthropicResolver).toHaveBeenCalledTimes(2);
    });

    it('is safe to call before the first resolve: a later resolve still builds once and caches normally', async () => {
      // Contract: clearing a never-populated cache must not corrupt caching. A bare
      // `not.toThrow()` can never fail (Map.clear() on an empty map cannot throw),
      // so instead drive the observable behavior — clear first, then resolve twice
      // and assert the model builds exactly once and the second call returns the
      // cached instance.
      resolveEffectiveModelKey.mockReturnValue('openai/gpt-4');
      const { resolveMastraModel, clearResolvedMastraModelCache } =
        await loadResolver();

      clearResolvedMastraModelCache();
      const first = await resolveMastraModel('openai/gpt-4');
      const second = await resolveMastraModel('openai/gpt-4');

      expect(openaiResolver).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });
});
