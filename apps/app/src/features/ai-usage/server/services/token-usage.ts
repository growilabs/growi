export type TokenUsage = {
  /** Total input tokens, including cached and cache-written tokens. */
  readonly inputTokens: number;
  /** Total output tokens, including reasoning tokens. */
  readonly outputTokens: number;
  /** null = the provider did not report it (not zero). */
  readonly reasoningTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
};

// Stays null only when no call reported a number; null counts as 0 beside a number.
const sumOptional = (values: readonly (number | null)[]): number | null => {
  const reported = values.filter((v): v is number => v != null);
  if (reported.length === 0) {
    return null;
  }
  return reported.reduce((acc, v) => acc + v, 0);
};

export const sumTokenUsage = (usages: readonly TokenUsage[]): TokenUsage => ({
  inputTokens: usages.reduce((acc, u) => acc + u.inputTokens, 0),
  outputTokens: usages.reduce((acc, u) => acc + u.outputTokens, 0),
  reasoningTokens: sumOptional(usages.map((u) => u.reasoningTokens)),
  cacheReadTokens: sumOptional(usages.map((u) => u.cacheReadTokens)),
  cacheWriteTokens: sumOptional(usages.map((u) => u.cacheWriteTokens)),
});
