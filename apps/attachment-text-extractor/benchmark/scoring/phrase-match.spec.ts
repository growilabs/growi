import { matchPhrase } from './phrase-match';

describe('matchPhrase', () => {
  it('is exact when the phrase appears as written', () => {
    expect(matchPhrase('当社の基幹システムは', { text: '基幹システム' })).toBe(
      'exact',
    );
  });

  it('is missing when the characters do not appear in order', () => {
    expect(matchPhrase('基幹のシステム', { text: '基幹システム' })).toBe(
      'missing',
    );
  });

  it('is a split elsewhere when whitespace cuts the phrase where no line break was printed', () => {
    expect(matchPhrase('基幹 システム', { text: '基幹システム' })).toBe(
      'split-elsewhere',
    );
  });

  it('is a split at the line break when only the printed line break position holds whitespace', () => {
    const phrase = { text: '基幹システム', lineBreakAfter: 4 };

    expect(matchPhrase('基幹シス\nテム', phrase)).toBe('split-at-line-break');
    expect(matchPhrase('基幹シス テム', phrase)).toBe('split-at-line-break');
  });

  it('is a split elsewhere when whitespace sits beyond the printed line break too', () => {
    expect(
      matchPhrase('基 幹シス テム', {
        text: '基幹システム',
        lineBreakAfter: 4,
      }),
    ).toBe('split-elsewhere');
  });

  it('treats other whitespace where the phrase itself has some as a whitespace difference, not as a split', () => {
    const phrase = { text: 'ISO/IEC 27001' };

    expect(matchPhrase('当社は ISO/IEC 27001 に', phrase)).toBe('exact');
    expect(matchPhrase('当社は ISO/IEC\n27001 に', phrase)).toBe(
      'whitespace-differs',
    );
    expect(matchPhrase('当社は ISO/IEC27001 に', phrase)).toBe(
      'whitespace-differs',
    );
    expect(matchPhrase('当社は IS O/IEC 27001 に', phrase)).toBe(
      'split-elsewhere',
    );
  });

  it('reads regular expression syntax in the phrase literally', () => {
    expect(matchPhrase('Cell 2,3 (a)', { text: '2,3 (a)' })).toBe('exact');
    expect(matchPhrase('Cell 2,3 a', { text: '2,3 (a)' })).toBe('missing');
    expect(matchPhrase('a.b', { text: 'a*b' })).toBe('missing');
  });
});
