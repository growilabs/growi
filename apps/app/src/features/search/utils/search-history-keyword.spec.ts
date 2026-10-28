import {
  SEARCH_HISTORY_KEYWORD_MAX_LENGTH,
  toExactMatchKeyword,
  toSearchHistoryKeyword,
} from './search-history-keyword';

describe('toSearchHistoryKeyword()', () => {
  it('should trim leading and trailing whitespace', () => {
    expect(toSearchHistoryKeyword('  foo  ')).toBe('foo');
    expect(toSearchHistoryKeyword('　foo\t\n')).toBe('foo');
  });

  it('should keep inner whitespace and letter case as is', () => {
    expect(toSearchHistoryKeyword(' Foo   Bar ')).toBe('Foo   Bar');
  });

  it('should keep operator tokens as typed', () => {
    expect(toSearchHistoryKeyword('prefix:/a tag:B -author:c "x y"')).toBe(
      'prefix:/a tag:B -author:c "x y"',
    );
  });

  it('should return null for an empty or whitespace-only input', () => {
    expect(toSearchHistoryKeyword('')).toBeNull();
    expect(toSearchHistoryKeyword(' \t　\n')).toBeNull();
  });

  it('should accept exactly the max length and reject one more', () => {
    expect(SEARCH_HISTORY_KEYWORD_MAX_LENGTH).toBe(200);
    expect(toSearchHistoryKeyword('a'.repeat(200))).toBe('a'.repeat(200));
    expect(toSearchHistoryKeyword('a'.repeat(201))).toBeNull();
  });

  it('should count a surrogate pair as one character', () => {
    expect(toSearchHistoryKeyword('😀'.repeat(200))).toBe('😀'.repeat(200));
    expect(toSearchHistoryKeyword('😀'.repeat(201))).toBeNull();
  });

  it('should measure the length after trimming', () => {
    expect(toSearchHistoryKeyword(` ${'a'.repeat(200)} `)).toBe(
      'a'.repeat(200),
    );
  });
});

describe('toExactMatchKeyword()', () => {
  it('should wrap the trimmed input in double quotes', () => {
    expect(toExactMatchKeyword('  foo bar ')).toBe('"foo bar"');
  });

  it('should return an empty string for a blank input', () => {
    expect(toExactMatchKeyword('   ')).toBe('');
  });

  it('should produce a keyword that is rejected when the quoted form exceeds the max', () => {
    expect(
      toSearchHistoryKeyword(toExactMatchKeyword('a'.repeat(198))),
    ).not.toBeNull();
    expect(
      toSearchHistoryKeyword(toExactMatchKeyword('a'.repeat(199))),
    ).toBeNull();
  });
});
