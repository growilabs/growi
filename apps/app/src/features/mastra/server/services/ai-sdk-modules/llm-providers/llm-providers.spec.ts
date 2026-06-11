import { LLM_PROVIDERS } from '~/features/mastra/interfaces/llm-provider';

// Each provider creator returns a "provider function" that, when called with a
// model id, yields a Mastra-compatible model. We mock the @ai-sdk/* + config
// boundaries so we can observe (a) the apiKey the creator is constructed with and
// (b) the model id applied. azure-openai resolves its own (richer) config, so it
// is mocked here and covered by azure-openai.spec.ts.
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
    resolveAzureOpenaiModel: vi.fn(() => ({ tag: 'azure-model' })),
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

const setKeyAndModel = (apiKey: string | undefined, model: string): void => {
  getConfig.mockImplementation((key: string) => {
    if (key === 'mastra:llmApiKey') return apiKey;
    if (key === 'mastra:llmModel') return model;
    return undefined;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('key-based provider resolvers', () => {
  it('resolveOpenaiModel constructs OpenAI with the config apiKey + model', () => {
    setKeyAndModel('sk-openai-123', 'gpt-test');

    const result = resolveOpenaiModel();

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-openai-123' });
    expect(openaiProviderFn).toHaveBeenCalledWith('gpt-test');
    expect(result).toEqual({ tag: 'openai-model', model: 'gpt-test' });
  });

  it('resolveAnthropicModel constructs Anthropic with the config apiKey + model', () => {
    setKeyAndModel('sk-anthropic-456', 'claude-test');

    const result = resolveAnthropicModel();

    expect(createAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-anthropic-456',
    });
    expect(anthropicProviderFn).toHaveBeenCalledWith('claude-test');
    expect(result).toEqual({ tag: 'anthropic-model', model: 'claude-test' });
  });

  it('resolveGoogleModel constructs Google with the config apiKey + model', () => {
    setKeyAndModel('sk-google-789', 'gemini-test');

    const result = resolveGoogleModel();

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: 'sk-google-789',
    });
    expect(googleProviderFn).toHaveBeenCalledWith('gemini-test');
    expect(result).toEqual({ tag: 'google-model', model: 'gemini-test' });
  });

  it('throws (naming MASTRA_LLM_API_KEY) when the api key is missing', () => {
    setKeyAndModel(undefined, 'gpt-test');

    expect(() => resolveOpenaiModel()).toThrow(/MASTRA_LLM_API_KEY/);
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it('injects the config apiKey explicitly (never the provider env var)', () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-should-not-be-used';
    try {
      setKeyAndModel('sk-explicit', 'gpt-test');
      resolveOpenaiModel();
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
      [...LLM_PROVIDERS].sort(),
    );
  });

  it('routes each provider key to its own resolver', () => {
    setKeyAndModel('sk', 'm');

    modelResolvers.openai();
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk' });

    modelResolvers.anthropic();
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk' });

    modelResolvers.google();
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'sk' });

    const azureResult = modelResolvers['azure-openai']();
    expect(resolveAzureOpenaiModel).toHaveBeenCalledTimes(1);
    expect(azureResult).toEqual({ tag: 'azure-model' });
  });
});
