import { describe, expect, it } from 'vitest';

import { buildSnippetSegments } from './build-snippet-segments';

describe('buildSnippetSegments', () => {
  describe('plain text (no em tags)', () => {
    it('returns a single plain segment for a simple string', () => {
      expect(buildSnippetSegments('hello world')).toEqual([
        { text: 'hello world', highlighted: false },
      ]);
    });

    it('returns empty array for empty string', () => {
      expect(buildSnippetSegments('')).toEqual([]);
    });
  });

  describe('highlighted segments', () => {
    it('wraps <em>...</em> content as highlighted', () => {
      expect(buildSnippetSegments('<em>match</em>')).toEqual([
        { text: 'match', highlighted: true },
      ]);
    });

    it('parses before and after plain text around a single <em>', () => {
      expect(buildSnippetSegments('before <em>match</em> after')).toEqual([
        { text: 'before ', highlighted: false },
        { text: 'match', highlighted: true },
        { text: ' after', highlighted: false },
      ]);
    });

    it('parses multiple <em> tags with text in between', () => {
      expect(
        buildSnippetSegments('<em>start</em> middle <em>end</em>'),
      ).toEqual([
        { text: 'start', highlighted: true },
        { text: ' middle ', highlighted: false },
        { text: 'end', highlighted: true },
      ]);
    });

    it('handles <em> at string start', () => {
      expect(buildSnippetSegments('<em>only</em>')).toEqual([
        { text: 'only', highlighted: true },
      ]);
    });

    it('filters out empty segments between adjacent <em> tags', () => {
      const result = buildSnippetSegments('<em>a</em><em>b</em>');
      expect(result).toEqual([
        { text: 'a', highlighted: true },
        { text: 'b', highlighted: true },
      ]);
    });
  });

  describe('malformed input handling', () => {
    it('treats unclosed <em> as plain text', () => {
      // No closing </em> — the whole thing is plain text
      expect(buildSnippetSegments('<em>unclosed')).toEqual([
        { text: '<em>unclosed', highlighted: false },
      ]);
    });

    it('treats orphan </em> as plain text', () => {
      expect(buildSnippetSegments('</em>orphan')).toEqual([
        { text: '</em>orphan', highlighted: false },
      ]);
    });

    it('handles nested <em> by treating inner <em> as plain text within highlighted segment', () => {
      // "<em>outer<em>inner</em>end</em>"
      // Outer <em> opens → highlighted segment starts, finds first </em> → "outer<em>inner"
      // Remaining: "end</em>" → treated as plain text (orphan </em>)
      const result = buildSnippetSegments('<em>outer<em>inner</em>end</em>');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ text: 'outer<em>inner', highlighted: true });
      expect(result[1]).toEqual({ text: 'end</em>', highlighted: false });
    });
  });

  describe('XSS / injection safety', () => {
    it('returns <script> tags as plain text (never executed)', () => {
      const result = buildSnippetSegments('<script>alert(1)</script>');
      expect(result).toEqual([
        { text: '<script>alert(1)</script>', highlighted: false },
      ]);
      // Must NOT produce highlighted:true for a script tag
      expect(result.every((s) => !s.highlighted)).toBe(true);
    });

    it('returns <img onerror=...> as plain text', () => {
      const result = buildSnippetSegments("<img onerror='xss()'> text");
      expect(result).toEqual([
        { text: "<img onerror='xss()'> text", highlighted: false },
      ]);
    });

    it('treats non-em HTML tags inside highlighted segment as plain text', () => {
      const result = buildSnippetSegments('<em><b>bold</b></em>');
      expect(result).toEqual([{ text: '<b>bold</b>', highlighted: true }]);
    });

    it('does not interpret <EM> (uppercase) as a highlight marker — only lowercase <em>', () => {
      // ES highlighter always emits lowercase, so uppercase should be plain text
      const result = buildSnippetSegments('<EM>upper</EM>');
      expect(result).toEqual([{ text: '<EM>upper</EM>', highlighted: false }]);
    });
  });

  describe('edge cases', () => {
    it('handles multiple adjacent plain text segments merged correctly', () => {
      expect(buildSnippetSegments('no tags here at all')).toEqual([
        { text: 'no tags here at all', highlighted: false },
      ]);
    });

    it('handles three <em> segments in sequence', () => {
      const result = buildSnippetSegments(
        'a <em>b</em> c <em>d</em> e <em>f</em>',
      );
      expect(result).toEqual([
        { text: 'a ', highlighted: false },
        { text: 'b', highlighted: true },
        { text: ' c ', highlighted: false },
        { text: 'd', highlighted: true },
        { text: ' e ', highlighted: false },
        { text: 'f', highlighted: true },
      ]);
    });
  });
});
