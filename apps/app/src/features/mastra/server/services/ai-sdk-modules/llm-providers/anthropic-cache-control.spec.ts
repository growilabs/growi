import type { JSONValue } from 'ai';
import { generateText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

import { anthropicCacheControlMiddleware } from './anthropic-cache-control';

// Drives the middleware through the real AI SDK wrapper and reports the
// providerOptions the underlying model actually receives.
const providerOptionsSeenByModel = async (
  callOptions: Record<string, Record<string, JSONValue>> | undefined,
) => {
  const base = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });

  await generateText({
    model: wrapLanguageModel({
      model: base,
      middleware: anthropicCacheControlMiddleware,
    }),
    prompt: 'hi',
    providerOptions: callOptions,
  });

  return base.doGenerateCalls[0].providerOptions;
};

describe('anthropicCacheControlMiddleware', () => {
  it('sends ephemeral cacheControl when the call declares no provider options', async () => {
    expect(await providerOptionsSeenByModel(undefined)).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('keeps the admin-configured anthropic options alongside cacheControl', async () => {
    expect(
      await providerOptionsSeenByModel({
        anthropic: { thinking: { type: 'enabled', budgetTokens: 12000 } },
      }),
    ).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 12000 },
        cacheControl: { type: 'ephemeral' },
      },
    });
  });

  it('lets an explicit admin cacheControl win (e.g. a 1h ttl)', async () => {
    expect(
      await providerOptionsSeenByModel({
        anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
      }),
    ).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
    });
  });

  it('treats an admin cacheControl of null as an opt-out: no cacheControl is sent and the call still succeeds', async () => {
    expect(
      await providerOptionsSeenByModel({
        anthropic: { cacheControl: null, sendReasoning: true },
      }),
    ).toEqual({ anthropic: { sendReasoning: true } });
  });

  it('leaves other provider namespaces untouched', async () => {
    expect(
      await providerOptionsSeenByModel({ openai: { reasoningEffort: 'high' } }),
    ).toEqual({
      openai: { reasoningEffort: 'high' },
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });
});
