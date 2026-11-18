import type { wrapLanguageModel } from 'ai';

import type { TokenUsage } from '~/features/ai-usage/server/services/token-usage';

// `ai` does not re-export the provider's v3 types, so derive them from its API.
export type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]['model'];
export type LanguageModelV3Usage = Awaited<
  ReturnType<LanguageModelV3['doGenerate']>
>['usage'];

export const fromLanguageModelUsage = (
  usage: LanguageModelV3Usage,
): TokenUsage => ({
  inputTokens: usage.inputTokens.total ?? 0,
  outputTokens: usage.outputTokens.total ?? 0,
  reasoningTokens: usage.outputTokens.reasoning ?? null,
  cacheReadTokens: usage.inputTokens.cacheRead ?? null,
  cacheWriteTokens: usage.inputTokens.cacheWrite ?? null,
});
