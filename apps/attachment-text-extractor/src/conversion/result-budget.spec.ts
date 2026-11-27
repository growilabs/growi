import { normalizeNewlines } from './normalize';
import { spendResultBudget } from './result-budget';
import { conversionErrorOf } from './spec-support';

describe('spendResultBudget', () => {
  it('adds the UTF-8 bytes of the content to the running total', () => {
    expect(spendResultBudget(10, normalizeNewlines('あ'), 100)).toBe(13);
  });

  it('adds nothing for empty content, even at the limit', () => {
    expect(spendResultBudget(100, normalizeNewlines(''), 100)).toBe(100);
  });

  it('accepts a total equal to the limit and refuses one byte more', async () => {
    expect(spendResultBudget(4, normalizeNewlines('xx'), 6)).toBe(6);

    const error = await conversionErrorOf(() =>
      spendResultBudget(5, normalizeNewlines('xx'), 6),
    );

    expect(error.kind).toBe('result_too_large');
  });
});
