import { callLlmForJson } from './call-llm-for-json';

const mocks = vi.hoisted(() => {
  return {
    chatCompletionMock: vi.fn(),
    getClientMock: vi.fn(),
    configManagerMock: {
      getConfig: vi.fn(),
    },
  };
});

vi.mock('~/features/openai/server/services/client-delegator', () => ({
  getClient: mocks.getClientMock,
  isStreamResponse: (result: unknown) => {
    return (
      result != null &&
      typeof result === 'object' &&
      Symbol.asyncIterator in (result as Record<symbol, unknown>)
    );
  },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: mocks.configManagerMock,
}));

const isString = (parsed: unknown): parsed is string =>
  typeof parsed === 'string';

/**
 * Regression guard for the multi-llm-provider feature.
 *
 * suggest-path resolves its LLM client exclusively through the openai
 * client-delegator, driven by the `openai:serviceType` config. It must remain
 * independent of mastra's provider selection (`mastra:llmProvider`): choosing a
 * non-OpenAI mastra provider must NOT reroute or alter suggest-path's LLM path.
 * call-llm-for-json is the single chokepoint where that client is selected, so
 * the independence contract is asserted here.
 */
describe('callLlmForJson client selection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getClientMock.mockReturnValue({
      chatCompletion: mocks.chatCompletionMock,
    });
    mocks.chatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify('ok') } }],
    });
  });

  it('should select the client from openai:serviceType (openai)', async () => {
    mocks.configManagerMock.getConfig.mockImplementation((key: string) => {
      if (key === 'openai:serviceType') return 'openai';
      return undefined;
    });

    await callLlmForJson('system', 'user', isString, 'invalid');

    expect(mocks.getClientMock).toHaveBeenCalledWith({
      openaiServiceType: 'openai',
    });
  });

  it('should select the client from openai:serviceType (azure-openai)', async () => {
    mocks.configManagerMock.getConfig.mockImplementation((key: string) => {
      if (key === 'openai:serviceType') return 'azure-openai';
      return undefined;
    });

    await callLlmForJson('system', 'user', isString, 'invalid');

    expect(mocks.getClientMock).toHaveBeenCalledWith({
      openaiServiceType: 'azure-openai',
    });
  });

  it('should ignore mastra:llmProvider when selecting the client (independence from mastra)', async () => {
    // A non-OpenAI mastra provider is configured; suggest-path must not be rerouted.
    mocks.configManagerMock.getConfig.mockImplementation((key: string) => {
      if (key === 'openai:serviceType') return 'openai';
      if (key === 'mastra:llmProvider') return 'anthropic';
      return undefined;
    });

    await callLlmForJson('system', 'user', isString, 'invalid');

    // Client selection is driven solely by openai:serviceType ...
    expect(mocks.getClientMock).toHaveBeenCalledWith({
      openaiServiceType: 'openai',
    });
    // ... and mastra:llmProvider is never consulted.
    expect(mocks.configManagerMock.getConfig).not.toHaveBeenCalledWith(
      'mastra:llmProvider',
    );
  });
});
