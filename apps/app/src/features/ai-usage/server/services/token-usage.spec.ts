import type { TokenUsage } from './token-usage';
import { sumTokenUsage } from './token-usage';

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  ...overrides,
});

describe('sumTokenUsage', () => {
  it('sums input and output tokens across calls', () => {
    const result = sumTokenUsage([
      usage({ inputTokens: 10, outputTokens: 1 }),
      usage({ inputTokens: 20, outputTokens: 2 }),
    ]);

    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(3);
  });

  it('keeps an optional field null when no call reported it', () => {
    const result = sumTokenUsage([
      usage({ inputTokens: 10 }),
      usage({ inputTokens: 20 }),
    ]);

    expect(result.reasoningTokens).toBeNull();
    expect(result.cacheReadTokens).toBeNull();
    expect(result.cacheWriteTokens).toBeNull();
  });

  it('sums an optional field when at least one call reported it, treating null as 0', () => {
    const result = sumTokenUsage([
      usage({ reasoningTokens: null, cacheReadTokens: 5 }),
      usage({ reasoningTokens: 7, cacheReadTokens: null }),
      usage({ reasoningTokens: 3, cacheReadTokens: 0 }),
    ]);

    expect(result.reasoningTokens).toBe(10);
    expect(result.cacheReadTokens).toBe(5);
    expect(result.cacheWriteTokens).toBeNull();
  });

  it('keeps a reported zero as 0 rather than null', () => {
    const result = sumTokenUsage([usage({ cacheWriteTokens: 0 })]);

    expect(result.cacheWriteTokens).toBe(0);
  });

  it('returns the single call as is', () => {
    const single = usage({
      inputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 1,
    });

    expect(sumTokenUsage([single])).toEqual(single);
  });

  it('returns zero totals with null optional fields for no calls', () => {
    expect(sumTokenUsage([])).toEqual(usage());
  });

  it('does not mutate its inputs', () => {
    const calls = [usage({ inputTokens: 1 }), usage({ inputTokens: 2 })];
    const snapshot = structuredClone(calls);

    sumTokenUsage(calls);

    expect(calls).toEqual(snapshot);
  });
});
