import type { IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type { UsageMeter } from '~/features/ai-usage/server';
import type SearchService from '~/server/service/search';

import { createGrowiAiRuntime } from './growi-ai-runtime';

// This is the one module that loads the AI stack, so its AI-bound imports are
// replaced at the module boundary: loading the real registry would build the
// MongoDB-backed memory and the provider configuration.
const mocks = vi.hoisted(() => ({
  getAgent:
    vi.fn<
      typeof import('~/features/mastra/server/services/mastra-modules')['mastra']['getAgent']
    >(),
  getEffectiveDefaultModelKey:
    vi.fn<
      typeof import('~/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key')['getEffectiveDefaultModelKey']
    >(),
  getProviderOptionsForModel:
    vi.fn<
      typeof import('~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options')['getProviderOptionsForModel']
    >(),
  createUsageMeter:
    vi.fn<typeof import('~/features/ai-usage/server')['createUsageMeter']>(),
}));

vi.mock('~/features/mastra/server/services/mastra-modules', () => ({
  mastra: { getAgent: mocks.getAgent },
}));
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key',
  () => ({ getEffectiveDefaultModelKey: mocks.getEffectiveDefaultModelKey }),
);
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options',
  () => ({ getProviderOptionsForModel: mocks.getProviderOptionsForModel }),
);
vi.mock('~/features/ai-usage/server', () => ({
  createUsageMeter: mocks.createUsageMeter,
}));

const MODEL_KEY = 'openai/gpt-default';
const MODEL_OPTIONS = { openai: { reasoningEffort: 'low' } };

const user = mock<IUserHasId>({ _id: '64b7f0c2a1b2c3d4e5f60718' });
const searchService = mock<SearchService>();

describe('createGrowiAiRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveDefaultModelKey.mockReturnValue(MODEL_KEY);
    mocks.getProviderOptionsForModel.mockImplementation((modelKey) =>
      modelKey === MODEL_KEY ? MODEL_OPTIONS : {},
    );
  });

  it('runs the GROWI agent from the Mastra registry', () => {
    const growiAgent = mock<ReturnType<typeof mocks.getAgent>>();
    mocks.getAgent.mockReturnValue(growiAgent);

    const runtime = createGrowiAiRuntime(searchService);

    expect(mocks.getAgent).toHaveBeenCalledWith('growiAgent');
    expect(runtime.agent).toBe(growiAgent);
  });

  it('runs each call as the given user, with the search service, the default model and a usage meter', () => {
    const usageMeter = mock<UsageMeter>();
    mocks.createUsageMeter.mockReturnValue(usageMeter);

    const run = createGrowiAiRuntime(searchService).beginRun(user);

    expect(run.requestContext.get('user')).toBe(user);
    expect(run.requestContext.get('searchService')).toBe(searchService);
    expect(run.requestContext.get('modelKey')).toBe(MODEL_KEY);
    expect(run.requestContext.get('usageMeter')).toBe(usageMeter);
    expect(run.providerOptions).toEqual(MODEL_OPTIONS);
    expect(mocks.createUsageMeter).toHaveBeenCalledWith({
      userId: user._id,
      feature: 'chat',
      modelKey: MODEL_KEY,
    });
  });

  it.each([
    'completed',
    'failed',
  ] as const)('closes the usage record as %s when the call finishes', (outcome) => {
    const usageMeter = mock<UsageMeter>();
    mocks.createUsageMeter.mockReturnValue(usageMeter);

    createGrowiAiRuntime(searchService).beginRun(user).finish(outcome);

    expect(usageMeter.close).toHaveBeenCalledWith({ outcome });
  });
});
