import { AI_PROVIDERS } from '~/features/mastra/interfaces/ai-provider';

// Each provider creator returns a "provider function" that, when called with a
// model id, yields a Mastra-compatible model. We mock the @ai-sdk/* boundaries and
// the per-provider config accessor `requireApiKey` so we can observe (a) that each
// resolver reads ITS OWN provider key (requireApiKey('openai') etc.) and (b) the
// model id applied. The model id arrives as the resolver argument (not from
// config). azure-openai resolves its own (richer) config, so it is mocked here and
// covered by azure-openai.spec.ts.
const {
  createOpenAI,
  createAnthropic,
  createGoogleGenerativeAI,
  openaiProviderFn,
  anthropicProviderFn,
  googleProviderFn,
  requireApiKey,
  resolveAzureOpenaiModel,
} = vi.hoisted(() => {
  const openaiProviderFn = vi.fn((modelId: string) => ({
    tag: 'openai-model',
    modelId,
  }));
  const anthropicProviderFn = vi.fn((modelId: string) => ({
    tag: 'anthropic-model',
    modelId,
  }));
  const googleProviderFn = vi.fn((modelId: string) => ({
    tag: 'google-model',
    modelId,
  }));
  return {
    openaiProviderFn,
    anthropicProviderFn,
    googleProviderFn,
    createOpenAI: vi.fn((_opts: { apiKey: string }) => openaiProviderFn),
    createAnthropic: vi.fn((_opts: { apiKey: string }) => anthropicProviderFn),
    createGoogleGenerativeAI: vi.fn(
      (_opts: { apiKey: string }) => googleProviderFn,
    ),
    // Returns a per-provider key so each resolver's provider argument is observable
    // in the apiKey passed to its creator.
    requireApiKey: vi.fn((provider: string) => `key-for-${provider}`),
    resolveAzureOpenaiModel: vi.fn(async (modelId: string) => ({
      tag: 'azure-model',
      modelId,
    })),
  };
});

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI }));
vi.mock('./config', () => ({ requireApiKey }));
vi.mock('./azure-openai', () => ({ resolveAzureOpenaiModel }));

import { resolveAnthropicModel } from './anthropic';
import { resolveGoogleModel } from './google';
import { modelResolvers } from './index';
import { resolveOpenaiModel } from './openai';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('key-based provider resolvers', () => {
  it('resolveOpenaiModel reads its OWN provider key and constructs OpenAI with it + the model argument', async () => {
    const result = await resolveOpenaiModel('gpt-test');

    expect(requireApiKey).toHaveBeenCalledWith('openai');
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'key-for-openai' });
    expect(openaiProviderFn).toHaveBeenCalledWith('gpt-test');
    expect(result).toEqual({ tag: 'openai-model', modelId: 'gpt-test' });
  });

  it('resolveAnthropicModel reads its OWN provider key and constructs Anthropic with it + the model argument', async () => {
    const result = await resolveAnthropicModel('claude-test');

    expect(requireApiKey).toHaveBeenCalledWith('anthropic');
    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'key-for-anthropic',
    });
    expect(anthropicProviderFn).toHaveBeenCalledWith('claude-test');
    expect(result).toEqual({ tag: 'anthropic-model', modelId: 'claude-test' });
  });

  it('resolveGoogleModel reads its OWN provider key and constructs Google with it + the model argument', async () => {
    const result = await resolveGoogleModel('gemini-test');

    expect(requireApiKey).toHaveBeenCalledWith('google');
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'key-for-google',
    });
    expect(googleProviderFn).toHaveBeenCalledWith('gemini-test');
    expect(result).toEqual({ tag: 'google-model', modelId: 'gemini-test' });
  });

  it('propagates the requireApiKey throw (missing key) without constructing the provider', async () => {
    requireApiKey.mockImplementationOnce((provider: string) => {
      throw new Error(`API key for provider "${provider}" is not configured`);
    });

    // Observable here: a missing key rejects before the provider is constructed
    // (createOpenAI, its exported creator, is never called). The stronger "SDK
    // not even loaded" property comes from the resolver reading the key BEFORE
    // its `await import()` — module loading is not observable under vi.mock, and
    // the import structure is guarded by lazy-provider-imports.spec.ts.
    await expect(resolveOpenaiModel('gpt-test')).rejects.toThrow(
      /not configured/,
    );
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('always injects an explicit apiKey option (never relies on the provider env var auto-detection)', async () => {
    await resolveOpenaiModel('gpt-test');

    // The creator ALWAYS receives an explicit apiKey option, so the resolver never
    // falls back to the @ai-sdk provider's own process.env auto-detection.
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.any(String) }),
    );
  });
});

describe('modelResolvers', () => {
  it('exposes exactly one resolver per known provider', () => {
    expect(Object.keys(modelResolvers).sort()).toEqual(
      [...AI_PROVIDERS].sort(),
    );
  });

  it('routes each provider key to its own resolver, forwarding the model argument and reading that provider key', async () => {
    expect(await modelResolvers.openai('m-openai')).toMatchObject({
      modelId: 'm-openai',
    });
    expect(requireApiKey).toHaveBeenCalledWith('openai');
    expect(openaiProviderFn).toHaveBeenCalledWith('m-openai');

    expect(await modelResolvers.anthropic('m-anthropic')).toMatchObject({
      modelId: 'm-anthropic',
    });
    expect(requireApiKey).toHaveBeenCalledWith('anthropic');
    expect(anthropicProviderFn).toHaveBeenCalledWith('m-anthropic');

    expect(await modelResolvers.google('m-google')).toMatchObject({
      modelId: 'm-google',
    });
    expect(requireApiKey).toHaveBeenCalledWith('google');
    expect(googleProviderFn).toHaveBeenCalledWith('m-google');

    const azureResult = await modelResolvers['azure-openai']('m-azure');
    expect(resolveAzureOpenaiModel).toHaveBeenCalledWith('m-azure');
    expect(azureResult).toEqual({ tag: 'azure-model', modelId: 'm-azure' });
  });
});
