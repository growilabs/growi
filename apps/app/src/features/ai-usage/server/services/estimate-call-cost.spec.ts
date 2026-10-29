import type { ModelPricing } from '~/features/mastra/server/services/ai-sdk-modules/build-model-catalog';

import { estimateCallCostUsd } from './estimate-call-cost';
import type { TokenUsage } from './token-usage';

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  ...overrides,
});

const cachedCall = usage({
  inputTokens: 1_000_000,
  cacheReadTokens: 400_000,
  cacheWriteTokens: 100_000,
  outputTokens: 200_000,
});

describe('estimateCallCostUsd', () => {
  describe('unit prices per token kind', () => {
    it('prices cache reads, cache writes, the remaining input and output with their own prices', () => {
      const pricing: ModelPricing = {
        input: 2,
        output: 10,
        cacheRead: 0.5,
        cacheWrite: 2.5,
      };

      // 500k * 2 + 400k * 0.5 + 100k * 2.5 + 200k * 10 = 1.0 + 0.2 + 0.25 + 2.0
      expect(estimateCallCostUsd(cachedCall, pricing)).toBeCloseTo(3.45, 10);
    });

    it('falls back to the input price when cache prices are missing', () => {
      const pricing: ModelPricing = { input: 2, output: 10 };

      // (500k + 400k + 100k) * 2 + 200k * 10 = 2.0 + 2.0
      expect(estimateCallCostUsd(cachedCall, pricing)).toBeCloseTo(4, 10);
    });

    it('falls back only for the missing cache price', () => {
      const pricing: ModelPricing = { input: 2, output: 10, cacheRead: 0.5 };

      // 500k * 2 + 400k * 0.5 + 100k * 2 + 200k * 10 = 1.0 + 0.2 + 0.2 + 2.0
      expect(estimateCallCostUsd(cachedCall, pricing)).toBeCloseTo(3.4, 10);
    });

    it('treats a price of 0 as a real price, not as unknown', () => {
      const pricing: ModelPricing = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };

      expect(estimateCallCostUsd(cachedCall, pricing)).toBe(0);
    });

    it('keeps a cache price of 0 instead of falling back to the input price', () => {
      const pricing: ModelPricing = { input: 2, output: 10, cacheRead: 0 };

      // 500k * 2 + 400k * 0 + 100k * 2 + 200k * 10 = 1.0 + 0 + 0.2 + 2.0
      expect(estimateCallCostUsd(cachedCall, pricing)).toBeCloseTo(3.2, 10);
    });

    it('does not add reasoning tokens on top of output tokens', () => {
      const pricing: ModelPricing = { input: 2, output: 10 };
      const withReasoning = usage({
        inputTokens: 100_000,
        outputTokens: 300_000,
        reasoningTokens: 250_000,
      });

      // 100k * 2 + 300k * 10 = 0.2 + 3.0
      expect(estimateCallCostUsd(withReasoning, pricing)).toBeCloseTo(3.2, 10);
    });

    it('treats unreported cache token counts as no cached input', () => {
      const pricing: ModelPricing = {
        input: 2,
        output: 10,
        cacheRead: 0.5,
        cacheWrite: 2.5,
      };
      const call = usage({ inputTokens: 1_000_000, outputTokens: 100_000 });

      // 1M * 2 + 100k * 10 = 2.0 + 1.0
      expect(estimateCallCostUsd(call, pricing)).toBeCloseTo(3, 10);
    });

    it('never prices a negative non-cached input when cache counts exceed the input total', () => {
      const pricing: ModelPricing = { input: 2, output: 10, cacheRead: 0.5 };
      const call = usage({ inputTokens: 100_000, cacheReadTokens: 200_000 });

      // non-cached input clamps to 0; 200k * 0.5 = 0.1
      expect(estimateCallCostUsd(call, pricing)).toBeCloseTo(0.1, 10);
    });

    it('returns 0 for a call that used no tokens', () => {
      expect(estimateCallCostUsd(usage(), { input: 2, output: 10 })).toBe(0);
    });
  });

  describe('tier selection', () => {
    const tiered: ModelPricing = {
      input: 1,
      output: 4,
      tiers: [
        { inputTokensAbove: 200_000, input: 2, output: 8 },
        { inputTokensAbove: 1_000_000, input: 4, output: 16 },
      ],
    };

    it('uses the base prices when the input equals a tier boundary', () => {
      const call = usage({ inputTokens: 200_000, outputTokens: 100_000 });

      // 200k * 1 + 100k * 4 = 0.2 + 0.4
      expect(estimateCallCostUsd(call, tiered)).toBeCloseTo(0.6, 10);
    });

    it('prices the whole call with the tier once the input exceeds its boundary', () => {
      const call = usage({ inputTokens: 500_000, outputTokens: 100_000 });

      // 500k * 2 + 100k * 8 = 1.0 + 0.8
      expect(estimateCallCostUsd(call, tiered)).toBeCloseTo(1.8, 10);
    });

    it('uses the exceeded tier with the largest boundary when several are exceeded', () => {
      const call = usage({ inputTokens: 1_500_000, outputTokens: 100_000 });

      // 1.5M * 4 + 100k * 16 = 6.0 + 1.6
      expect(estimateCallCostUsd(call, tiered)).toBeCloseTo(7.6, 10);
    });

    it('does not back-fill a missing cache price of the tier from the base cache price', () => {
      const pricing: ModelPricing = {
        input: 1,
        output: 4,
        cacheRead: 0.1,
        tiers: [{ inputTokensAbove: 200_000, input: 2, output: 8 }],
      };
      const call = usage({
        inputTokens: 500_000,
        cacheReadTokens: 300_000,
        outputTokens: 100_000,
      });

      // tier has no cacheRead -> tier input price: (200k + 300k) * 2 + 100k * 8 = 1.0 + 0.8
      expect(estimateCallCostUsd(call, pricing)).toBeCloseTo(1.8, 10);
    });

    it('returns null when the selected tier lacks an output price the base has', () => {
      const pricing: ModelPricing = {
        input: 1,
        output: 4,
        tiers: [{ inputTokensAbove: 200_000, input: 2 }],
      };
      const call = usage({ inputTokens: 500_000, outputTokens: 100_000 });

      expect(estimateCallCostUsd(call, pricing)).toBeNull();
    });

    it('returns null when the selected tier lacks an input price the base has', () => {
      const pricing: ModelPricing = {
        input: 1,
        output: 4,
        tiers: [{ inputTokensAbove: 200_000, output: 8 }],
      };
      const call = usage({ inputTokens: 500_000, outputTokens: 100_000 });

      expect(estimateCallCostUsd(call, pricing)).toBeNull();
    });
  });

  describe('unknown prices', () => {
    it('returns null when the input price is unknown', () => {
      const call = usage({ inputTokens: 1_000, outputTokens: 1_000 });

      expect(estimateCallCostUsd(call, { output: 10 })).toBeNull();
    });

    it('returns null when the output price is unknown', () => {
      const call = usage({ inputTokens: 1_000, outputTokens: 1_000 });

      expect(
        estimateCallCostUsd(call, { input: 2, cacheRead: 0.5 }),
      ).toBeNull();
    });

    it('returns null when no price is known at all', () => {
      expect(estimateCallCostUsd(usage(), {})).toBeNull();
    });
  });
});
