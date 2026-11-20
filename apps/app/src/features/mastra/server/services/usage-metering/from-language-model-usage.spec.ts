import {
  fromLanguageModelUsage,
  type LanguageModelV3Usage,
} from './from-language-model-usage';

const usageOf = (
  input: Partial<LanguageModelV3Usage['inputTokens']>,
  output: Partial<LanguageModelV3Usage['outputTokens']>,
): LanguageModelV3Usage => ({
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
    ...input,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
    ...output,
  },
});

describe('fromLanguageModelUsage', () => {
  it('maps every reported field', () => {
    const usage = usageOf(
      { total: 1000, noCache: 600, cacheRead: 300, cacheWrite: 100 },
      { total: 200, text: 150, reasoning: 50 },
    );

    expect(fromLanguageModelUsage(usage)).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
    });
  });

  it('keeps fields the provider did not report as null, not 0', () => {
    const usage = usageOf({ total: 10 }, { total: 5 });

    expect(fromLanguageModelUsage(usage)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
  });

  it('keeps a reported 0 as 0, not null', () => {
    const usage = usageOf(
      { total: 10, cacheRead: 0, cacheWrite: 0 },
      { total: 5, reasoning: 0 },
    );

    expect(fromLanguageModelUsage(usage)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('treats a missing input or output total as 0', () => {
    const usage = usageOf({}, {});

    expect(fromLanguageModelUsage(usage)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
  });
});
