import { spendResultBudget } from './result-budget';
import { conversionErrorOf } from './spec-support';

describe('spendResultBudget', () => {
  it('adds the UTF-8 bytes of the content to the running total', () => {
    expect(spendResultBudget(10, 'あ', 100)).toBe(13);
  });

  it('counts a CRLF or CR as one byte, as it is after unification', () => {
    expect(spendResultBudget(0, 'a\r\nb\rc', 100)).toBe(5);
  });

  it('adds nothing for empty content, even at the limit', () => {
    expect(spendResultBudget(100, '', 100)).toBe(100);
  });

  it('accepts a total equal to the limit and refuses one byte more', async () => {
    expect(spendResultBudget(4, 'xx', 6)).toBe(6);

    const error = await conversionErrorOf(() => spendResultBudget(5, 'xx', 6));

    expect(error.kind).toBe('result_too_large');
  });
});
