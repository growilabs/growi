import { parseTagNames } from './parse-tag-names.js';

describe('parseTagNames()', () => {
  it('returns an array with a single tag name when given one tag with no commas', () => {
    // when
    const result = parseTagNames('meeting-notes');

    // then
    expect(result).toEqual(['meeting-notes']);
  });

  it('returns a trimmed array of all tag names when given multiple comma-separated tags with extra whitespace', () => {
    // when
    const result = parseTagNames(' foo , bar,  baz ');

    // then
    expect(result).toEqual(['foo', 'bar', 'baz']);
  });

  it('deduplicates tag names that appear more than once', () => {
    // when
    const result = parseTagNames('foo,bar,foo');

    // then
    expect(result).toEqual(['foo', 'bar']);
  });

  it('drops empty pieces from a leading/trailing comma while keeping the valid tag names', () => {
    // when
    const result = parseTagNames(',a,b');

    // then
    expect(result).toEqual(['a', 'b']);
  });

  it('drops empty pieces from a trailing comma while keeping the valid tag names', () => {
    // when
    const result = parseTagNames('a,b,');

    // then
    expect(result).toEqual(['a', 'b']);
  });

  describe('throws http-errors instance', () => {
    it('when given an empty string', () => {
      // when
      const caller = () => parseTagNames('');

      // then
      expect(caller).toThrowError('tag option requires at least one tag name.');
    });

    it('when given a whitespace-only string', () => {
      // when
      const caller = () => parseTagNames('   ');

      // then
      expect(caller).toThrowError('tag option requires at least one tag name.');
    });

    it('when given `true` (option present with no value)', () => {
      // when
      const caller = () => parseTagNames(true);

      // then
      expect(caller).toThrowError('tag option requires at least one tag name.');
    });

    it('when given a comma-only string whose pieces are all empty after trimming', () => {
      // when
      const caller = () => parseTagNames(' , , ');

      // then
      expect(caller).toThrowError('tag option requires at least one tag name.');
    });
  });
});
