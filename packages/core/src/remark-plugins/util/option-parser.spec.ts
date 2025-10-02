import { OptionParser } from './option-parser';

describe('option-parser', () => {
  test.concurrent.each`
    arg
    ${'aaa'}
    ${'5++2'}
    ${'5:+2'}
  `(".parseRange('$arg') returns null", ({ arg }) => {
    expect(OptionParser.parseRange(arg)).toBeNull();
  });

  test.concurrent.each`
    arg        | start | end
    ${'1'}     | ${1}  | ${1}
    ${'2:1'}   | ${2}  | ${1}
    ${'2:'}    | ${2}  | ${-1}
    ${'10:-3'} | ${10} | ${-3}
    ${'5+2'}   | ${5}  | ${7}
    ${'5+'}    | ${5}  | ${5}
  `(
    ".parseRange('$arg') returns { start: $start, end : $end }",
    ({ arg, start, end }) => {
      expect(OptionParser.parseRange(arg)).toEqual({ start, end });
    },
  );
});
