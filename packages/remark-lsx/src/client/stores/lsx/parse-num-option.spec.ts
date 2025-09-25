import { OptionParser } from '@growi/core/dist/remark-plugins';

import { parseNumOption } from './parse-num-option';

describe('addNumCondition()', () => {
  it('set limit with the specified number', () => {
    // setup
    const parseRangeSpy = vi.spyOn(OptionParser, 'parseRange');

    // when
    const result = parseNumOption('99');

    // then
    expect(result).toEqual({ limit: 99 });
    expect(parseRangeSpy).not.toHaveBeenCalled();
  });

  it('returns null when the option value is invalid', () => {
    // setup
    const parseRangeSpy = vi.spyOn(OptionParser, 'parseRange');

    // when
    const result = parseNumOption('invalid string');

    // then
    expect(parseRangeSpy).toHaveBeenCalledWith('invalid string');
    expect(result).toBeNull();
  });

  it('throws an error when the start value is smaller than 1', () => {
    // setup
    const parseRangeSpy = vi.spyOn(OptionParser, 'parseRange');

    // when
    const caller = () => parseNumOption('-1:10');

    // then
    expect(caller).toThrowError(
      "The specified option 'num' is { start: -1, end: 10 } : the start must be larger or equal than 1",
    );
    expect(parseRangeSpy).toHaveBeenCalledWith('-1:10');
  });

  it('throws an error when the end value is smaller than the start value', () => {
    // setup
    const parseRangeSpy = vi.spyOn(OptionParser, 'parseRange');

    // when
    const caller = () => parseNumOption('3:2');

    // then
    expect(caller).toThrowError(
      "The specified option 'num' is { start: 3, end: 2 } : the end must be larger or equal than the start",
    );
    expect(parseRangeSpy).toHaveBeenCalledWith('3:2');
  });
});

describe('addNumCondition() set skip and limit with the range string', () => {
  it.concurrent.each`
    optionsNum | expected
    ${'1:10'}  | ${{ offset: 0, limit: 10 }}
    ${'2:2'}   | ${{ offset: 1, limit: 1 }}
    ${'3:'}    | ${{ offset: 2, limit: -1 }}
  `("'$optionsNum", ({ optionsNum, expected }) => {
    // setup
    const parseRangeSpy = vi.spyOn(OptionParser, 'parseRange');

    // when
    const result = parseNumOption(optionsNum);

    // then
    expect(parseRangeSpy).toHaveBeenCalledWith(optionsNum);
    expect(result).toEqual(expected);
  });
});
