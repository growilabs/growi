import { LLM_VENDORS } from '~/features/mastra/interfaces/llm-vendor';

// Each provider creator returns a "provider function" that, when called with a
// model id, yields a LanguageModel. We mock the @ai-sdk/* boundary so we can
// observe (a) the options the creator is constructed with and (b) the model id
// applied to the returned provider function.
// vi.hoisted keeps these spies available when the hoisted vi.mock factories run.
const {
  createOpenAI,
  createAnthropic,
  createGoogleGenerativeAI,
  openaiProviderFn,
  anthropicProviderFn,
  googleProviderFn,
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
  };
});

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI }));

import { createAnthropicModel } from './anthropic';
import { createGoogleModel } from './google';
import { llmModelFactories } from './index';
import { createOpenAiModel } from './openai';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('llm provider factories', () => {
  describe('createOpenAiModel', () => {
    it('constructs the OpenAI provider with the explicit apiKey and applies the model', () => {
      const result = createOpenAiModel({
        apiKey: 'sk-openai-123',
        model: 'gpt-test',
      });

      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-openai-123' });
      expect(openaiProviderFn).toHaveBeenCalledWith('gpt-test');
      expect(result).toEqual({ tag: 'openai-model', model: 'gpt-test' });
    });
  });

  describe('createAnthropicModel', () => {
    it('constructs the Anthropic provider with the explicit apiKey and applies the model', () => {
      const result = createAnthropicModel({
        apiKey: 'sk-anthropic-456',
        model: 'claude-test',
      });

      expect(createAnthropic).toHaveBeenCalledWith({
        apiKey: 'sk-anthropic-456',
      });
      expect(anthropicProviderFn).toHaveBeenCalledWith('claude-test');
      expect(result).toEqual({ tag: 'anthropic-model', model: 'claude-test' });
    });
  });

  describe('createGoogleModel', () => {
    it('constructs the Google provider with the explicit apiKey and applies the model', () => {
      const result = createGoogleModel({
        apiKey: 'sk-google-789',
        model: 'gemini-test',
      });

      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({
        apiKey: 'sk-google-789',
      });
      expect(googleProviderFn).toHaveBeenCalledWith('gemini-test');
      expect(result).toEqual({ tag: 'google-model', model: 'gemini-test' });
    });
  });

  describe('apiKey is injected explicitly (not from process.env)', () => {
    it('passes the given apiKey through even when an env var is present', () => {
      const original = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'env-should-not-be-used';
      try {
        createOpenAiModel({ apiKey: 'sk-explicit', model: 'gpt-test' });
        // The creator must receive the explicit key, never read from env.
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

  describe('llmModelFactories map', () => {
    it('exposes exactly one factory per known vendor', () => {
      expect(Object.keys(llmModelFactories).sort()).toEqual(
        [...LLM_VENDORS].sort(),
      );
    });

    it('routes each vendor key to its corresponding factory', () => {
      llmModelFactories.openai({ apiKey: 'sk-o', model: 'm-o' });
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-o' });
      expect(openaiProviderFn).toHaveBeenCalledWith('m-o');

      llmModelFactories.anthropic({ apiKey: 'sk-a', model: 'm-a' });
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-a' });
      expect(anthropicProviderFn).toHaveBeenCalledWith('m-a');

      llmModelFactories.google({ apiKey: 'sk-g', model: 'm-g' });
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'sk-g' });
      expect(googleProviderFn).toHaveBeenCalledWith('m-g');
    });
  });
});
