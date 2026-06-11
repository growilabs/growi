import { LLM_PROVIDERS } from '~/features/mastra/interfaces/llm-provider';

// Each provider creator returns a "provider function" that, when called with a
// model id, yields a Mastra-compatible model (MastraModelConfig). We mock the
// @ai-sdk/* boundary so we can
// observe (a) the options the creator is constructed with and (b) the model id
// applied to the returned provider function.
// vi.hoisted keeps these spies available when the hoisted vi.mock factories run.
const {
  createOpenAI,
  createAnthropic,
  createGoogleGenerativeAI,
  createAzure,
  DefaultAzureCredential,
  getBearerTokenProvider,
  tokenProviderSentinel,
  openaiProviderFn,
  anthropicProviderFn,
  googleProviderFn,
  azureProviderFn,
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
  const azureProviderFn = vi.fn((model: string) => ({
    tag: 'azure-model',
    model,
  }));
  // Sentinel returned by the mocked getBearerTokenProvider so the Entra ID test
  // can assert it is forwarded to createAzure as `tokenProvider`.
  const tokenProviderSentinel = (): Promise<string> =>
    Promise.resolve('fake-token');
  return {
    openaiProviderFn,
    anthropicProviderFn,
    googleProviderFn,
    azureProviderFn,
    tokenProviderSentinel,
    createOpenAI: vi.fn((_opts: { apiKey: string }) => openaiProviderFn),
    createAnthropic: vi.fn((_opts: { apiKey: string }) => anthropicProviderFn),
    createGoogleGenerativeAI: vi.fn(
      (_opts: { apiKey: string }) => googleProviderFn,
    ),
    // Azure accepts resourceName | baseURL (mutually exclusive), optional
    // apiVersion, and either an apiKey or a tokenProvider (Entra ID).
    createAzure: vi.fn(
      (_opts: {
        apiKey?: string;
        tokenProvider?: () => Promise<string>;
        resourceName?: string;
        baseURL?: string;
        apiVersion?: string;
      }) => azureProviderFn,
    ),
    DefaultAzureCredential: vi.fn(),
    getBearerTokenProvider: vi.fn(() => tokenProviderSentinel),
  };
});

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI }));
vi.mock('@ai-sdk/azure', () => ({ createAzure }));
// Mock @azure/identity (static import in azure-openai.ts) so the Entra ID path
// is deterministic and fast — no real credential chain is constructed.
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential,
  getBearerTokenProvider,
}));

import { createAnthropicModel } from './anthropic';
import { createAzureOpenaiModel } from './azure-openai';
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

  describe('createAzureOpenaiModel', () => {
    it('constructs the Azure provider with resourceName and applies the deployment name', () => {
      const result = createAzureOpenaiModel({
        apiKey: 'az-key-1',
        model: 'my-deployment',
        azureOpenai: { resourceName: 'my-resource' },
      });

      expect(createAzure).toHaveBeenCalledWith({
        apiKey: 'az-key-1',
        resourceName: 'my-resource',
      });
      expect(azureProviderFn).toHaveBeenCalledWith('my-deployment');
      expect(result).toEqual({ tag: 'azure-model', model: 'my-deployment' });
    });

    it('constructs the Azure provider with baseURL when given', () => {
      createAzureOpenaiModel({
        apiKey: 'az-key-2',
        model: 'dep',
        azureOpenai: { baseURL: 'https://gw.example.com/openai/deployments' },
      });

      expect(createAzure).toHaveBeenCalledWith({
        apiKey: 'az-key-2',
        baseURL: 'https://gw.example.com/openai/deployments',
      });
    });

    it('prefers baseURL over resourceName when both are set (AI SDK is exclusive)', () => {
      createAzureOpenaiModel({
        apiKey: 'az-key-3',
        model: 'dep',
        azureOpenai: {
          resourceName: 'should-be-ignored',
          baseURL: 'https://gw.example.com',
        },
      });

      // resourceName must NOT be forwarded when baseURL wins.
      expect(createAzure).toHaveBeenCalledWith({
        apiKey: 'az-key-3',
        baseURL: 'https://gw.example.com',
      });
    });

    it('forwards apiVersion only when set', () => {
      createAzureOpenaiModel({
        apiKey: 'az-key-4',
        model: 'dep',
        azureOpenai: { resourceName: 'res', apiVersion: '2024-10-01-preview' },
      });

      expect(createAzure).toHaveBeenCalledWith({
        apiKey: 'az-key-4',
        resourceName: 'res',
        apiVersion: '2024-10-01-preview',
      });
    });

    it('throws (naming the env vars, never the key) when neither resourceName nor baseURL is set', () => {
      const apiKey = 'az-super-secret';

      expect(() =>
        createAzureOpenaiModel({ apiKey, model: 'dep', azureOpenai: {} }),
      ).toThrow(
        /MASTRA_LLM_AZURE_OPENAI_RESOURCE_NAME|MASTRA_LLM_AZURE_OPENAI_BASE_URL/,
      );
      // The provider must not be constructed on the throw path.
      expect(createAzure).not.toHaveBeenCalled();

      try {
        createAzureOpenaiModel({ apiKey, model: 'dep' });
      } catch (e) {
        expect((e as Error).message).not.toContain(apiKey);
      }
    });

    it('authenticates via Microsoft Entra ID (tokenProvider) instead of an apiKey when useEntraId is set', () => {
      const result = createAzureOpenaiModel({
        // no apiKey in Entra ID mode
        model: 'my-deployment',
        azureOpenai: { resourceName: 'my-resource', useEntraId: true },
      });

      // Observable contract: a token provider (Entra ID) — not an apiKey — is
      // forwarded to the SDK alongside the endpoint.
      expect(getBearerTokenProvider).toHaveBeenCalledWith(
        expect.anything(),
        'https://cognitiveservices.azure.com/.default',
      );
      expect(createAzure).toHaveBeenCalledWith({
        resourceName: 'my-resource',
        tokenProvider: tokenProviderSentinel,
      });
      expect(createAzure).not.toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: expect.anything() }),
      );
      expect(azureProviderFn).toHaveBeenCalledWith('my-deployment');
      expect(result).toEqual({ tag: 'azure-model', model: 'my-deployment' });
    });

    it('throws when neither an apiKey nor Entra ID is configured (endpoint present)', () => {
      expect(() =>
        createAzureOpenaiModel({
          model: 'dep',
          azureOpenai: { resourceName: 'my-resource' },
        }),
      ).toThrow(/MASTRA_LLM_API_KEY|MASTRA_LLM_AZURE_OPENAI_USE_ENTRA_ID/);
      expect(createAzure).not.toHaveBeenCalled();
    });
  });

  // Note: openai/anthropic/google require `apiKey` at the type level
  // (LlmModelFactoryParams), so a missing key is a compile error rather than a
  // runtime guard — there is nothing to assert at runtime for that case.

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
    it('exposes exactly one factory per known provider', () => {
      expect(Object.keys(llmModelFactories).sort()).toEqual(
        [...LLM_PROVIDERS].sort(),
      );
    });

    it('routes each provider key to its corresponding factory', () => {
      llmModelFactories.openai({ apiKey: 'sk-o', model: 'm-o' });
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-o' });
      expect(openaiProviderFn).toHaveBeenCalledWith('m-o');

      llmModelFactories.anthropic({ apiKey: 'sk-a', model: 'm-a' });
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-a' });
      expect(anthropicProviderFn).toHaveBeenCalledWith('m-a');

      llmModelFactories.google({ apiKey: 'sk-g', model: 'm-g' });
      expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'sk-g' });
      expect(googleProviderFn).toHaveBeenCalledWith('m-g');

      llmModelFactories['azure-openai']({
        apiKey: 'sk-az',
        model: 'm-az',
        azureOpenai: { resourceName: 'res' },
      });
      expect(createAzure).toHaveBeenCalledWith({
        apiKey: 'sk-az',
        resourceName: 'res',
      });
      expect(azureProviderFn).toHaveBeenCalledWith('m-az');
    });
  });
});
