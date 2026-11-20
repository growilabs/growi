import type {
  ModelPricing,
  ModelUnitPrices,
} from '~/features/mastra/server/services/ai-sdk-modules/build-model-catalog';

import type { TokenUsage } from './token-usage';

export const TOKENS_PER_PRICE_UNIT = 1_000_000;

// The exceeded tier with the largest boundary wins; its missing fields are
// never filled from the base prices (see design.md EstimateCallCost).
const selectUnitPrices = (
  inputTokens: number,
  pricing: ModelPricing,
): ModelUnitPrices => {
  const exceeded = (pricing.tiers ?? []).filter(
    (tier) => inputTokens > tier.inputTokensAbove,
  );
  if (exceeded.length === 0) {
    return pricing;
  }
  return exceeded.reduce((max, tier) =>
    tier.inputTokensAbove > max.inputTokensAbove ? tier : max,
  );
};

/** Returns null when input or output price is unknown for the chosen tier. */
export const estimateCallCostUsd = (
  usage: TokenUsage,
  pricing: ModelPricing,
): number | null => {
  const prices = selectUnitPrices(usage.inputTokens, pricing);
  const { input, output } = prices;
  if (input == null || output == null) {
    return null;
  }

  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const nonCachedInputTokens = Math.max(
    0,
    usage.inputTokens - cacheReadTokens - cacheWriteTokens,
  );

  const weightedTokens =
    nonCachedInputTokens * input +
    cacheReadTokens * (prices.cacheRead ?? input) +
    cacheWriteTokens * (prices.cacheWrite ?? input) +
    usage.outputTokens * output;

  return weightedTokens / TOKENS_PER_PRICE_UNIT;
};
