import { AI_PROVIDERS } from '~/features/mastra/interfaces/ai-provider';

// Each provider creator returns a "provider function" that, when called with a
// model id, yields a Mastra-compatible model. We mock the @ai-sdk/* + config
// boundaries so we can observe (a) the apiKey the creator is constructed with and
// (b) the model id applied. The model id now arrives as the resolver argument
// (not from config). azure-openai resolves its own (richer) config, so it is
// mocked here and covered by azure-openai.spec.ts.
const {
  createOpenAI,
  createAnthropic,
  createGoogleGenerativeAI,
  openaiProviderFn,
  anthropicProviderFn,
  googleProviderFn,
  getConfig,
  resolveAzureOpenaiModel,
} = vi.hoisted(() => {
  const openaiProviderFn = vi.fn((model: string) => ({
    tag: 'openai-model',
    model,
  }));
  const anthropicProviderFn = vi.fn((model: string) => ({
    tag: 'anthropic-model',
    model,
  }));
  const googleProviderFn = vi.fn((model: string) => ({
    tag: 'google-model',
    model,
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
    getConfig: vi.fn(),
    resolveAzureOpenaiModel: vi.fn((model: string) => ({
      tag: 'azure-model',
      model,
    })),
  };
});

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI }));
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));
vi.mock('./azure-openai', () => ({ resolveAzureOpenaiModel }));

import { resolveAnthropicModel } from './anthropic';
import { resolveGoogleModel } from './google';
import { modelResolvers } from './index';
import { resolveOpenaiModel } from './openai';

// Only the api key comes from config now; the model id is the resolver argument.
const setApiKey = (apiKey: string | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'ai:apiKey' ? apiKey : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('key-based provider resolvers', () => {
  it('resolveOpenaiModel constructs OpenAI with the config apiKey + the model argument', () => {
    setApiKey('sk-openai-123');

    const result = resolveOpenaiModel('gpt-test');

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-openai-123' });
    expect(openaiProviderFn).toHaveBeenCalledWith('gpt-test');
    expect(result).toEqual({ tag: 'openai-model', model: 'gpt-test' });
  });

  it('resolveAnthropicModel constructs Anthropic with the config apiKey + the model argument', () => {
    setApiKey('sk-anthropic-456');

    const result = resolveAnthropicModel('claude-test');

    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-anthropic-456',
    });
    expect(anthropicProviderFn).toHaveBeenCalledWith('claude-test');
    expect(result).toEqual({ tag: 'anthropic-model', model: 'claude-test' });
  });

  it('resolveGoogleModel constructs Google with the config apiKey + the model argument', () => {
    setApiKey('sk-google-789');

    const result = resolveGoogleModel('gemini-test');

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'sk-google-789',
    });
    expect(googleProviderFn).toHaveBeenCalledWith('gemini-test');
    expect(result).toEqual({ tag: 'google-model', model: 'gemini-test' });
  });

  it('throws (naming AI_API_KEY) when the api key is missing', () => {
    setApiKey(undefined);

    expect(() => resolveOpenaiModel('gpt-test')).toThrow(/AI_API_KEY/);
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('injects the config apiKey explicitly (never the provider env var)', () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-should-not-be-used';
    try {
      setApiKey('sk-explicit');
      resolveOpenaiModel('gpt-test');
      // The creator receives the config key, never the provider's env var.
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-explicit' });
    } finally {
      if (original == null) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = original;
      }
    }
  });
});

describe('modelResolvers', () => {
  it('exposes exactly one resolver per known provider', () => {
    expect(Object.keys(modelResolvers).sort()).toEqual(
      [...AI_PROVIDERS].sort(),
    );
  });

  it('routes each provider key to its own resolver, forwarding the model argument', () => {
    setApiKey('sk');

    expect(modelResolvers.openai('m-openai')).toMatchObject({
      model: 'm-openai',
    });
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk' });
    expect(openaiProviderFn).toHaveBeenCalledWith('m-openai');

    expect(modelResolvers.anthropic('m-anthropic')).toMatchObject({
      model: 'm-anthropic',
    });
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk' });
    expect(anthropicProviderFn).toHaveBeenCalledWith('m-anthropic');

    expect(modelResolvers.google('m-google')).toMatchObject({
      model: 'm-google',
    });
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'sk' });
    expect(googleProviderFn).toHaveBeenCalledWith('m-google');

    const azureResult = modelResolvers['azure-openai']('m-azure');
    expect(resolveAzureOpenaiModel).toHaveBeenCalledWith('m-azure');
    expect(azureResult).toEqual({ tag: 'azure-model', model: 'm-azure' });
  });
});
