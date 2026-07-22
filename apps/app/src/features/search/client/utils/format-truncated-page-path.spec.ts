import { formatTruncatedPagePath } from './format-truncated-page-path';

describe('formatTruncatedPagePath', () => {
  describe('root paths', () => {
    it.each(['/', ''])('returns isRoot with empty parts for %p', (path) => {
      const result = formatTruncatedPagePath(path);

      expect(result.isRoot).toBe(true);
      expect(result.parts).toEqual([]);
      expect(result.fullPath).toBe('/');
    });
  });

  describe('short paths (units <= 3): every unit shown, no ellipsis', () => {
    it('shows only the page name for a single-unit path (/A)', () => {
      const result = formatTruncatedPagePath('/A');

      expect(result.isRoot).toBe(false);
      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/A');
    });

    it('shows one ancestor + page name for a two-unit path (/A/B)', () => {
      const result = formatTruncatedPagePath('/A/B');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'segment', text: 'B', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/A/B');
    });

    it('shows all three units for a three-unit path (/A/B/C)', () => {
      const result = formatTruncatedPagePath('/A/B/C');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'segment', text: 'B', isPageName: false },
        { type: 'segment', text: 'C', isPageName: true },
      ]);
      // only the last segment is the page name
      expect(
        result.parts.filter((p) => p.type === 'segment' && p.isPageName),
      ).toHaveLength(1);
      // no ellipsis for short paths
      expect(result.parts.some((p) => p.type === 'ellipsis')).toBe(false);
    });
  });

  describe('truncated paths (units >= 4): first + ellipsis + parent + page name', () => {
    it('collapses exactly one middle ancestor for a four-unit path (/A/B/C/D)', () => {
      const result = formatTruncatedPagePath('/A/B/C/D');

      // ancestors = [A, B, C], page name = D; the single middle ancestor (B) is collapsed
      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: 'C', isPageName: false },
        { type: 'segment', text: 'D', isPageName: true },
      ]);
      expect(result.parts.filter((p) => p.type === 'ellipsis')).toHaveLength(1);
      expect(result.fullPath).toBe('/A/B/C/D');
    });

    it('keeps first, parent, and page name for a deep path (/A/B/C/D/E/F/G)', () => {
      const result = formatTruncatedPagePath('/A/B/C/D/E/F/G');

      // ancestors = [A, B, C, D, E, F], page name = G
      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: 'F', isPageName: false },
        { type: 'segment', text: 'G', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/A/B/C/D/E/F/G');
    });
  });

  describe('date paths (page name determined by DevidedPagePath evalDatePath rule)', () => {
    it('bundles a trailing date as the page name when preceded by >= 2 ancestor segments', () => {
      // DevidedPagePath bundles /YYYY/MM/DD only when the ancestor part still
      // contains a slash (>= 2 segments). Here ancestors = [Projects, team, notes],
      // page name = '2024/01/01' -> 4 units -> truncated.
      const result = formatTruncatedPagePath('/Projects/team/notes/2024/01/01');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'Projects', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: 'notes', isPageName: false },
        { type: 'segment', text: '2024/01/01', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/Projects/team/notes/2024/01/01');
    });

    it('does NOT bundle a trailing date when only one ancestor segment precedes it', () => {
      // Documents actual DevidedPagePath behavior: /notes/2024/01/01 leaves the
      // ancestor part '/notes' (single segment), so the date pattern does not match
      // and the last path element '01' becomes the page name. ancestors = [notes, 2024, 01].
      const result = formatTruncatedPagePath('/notes/2024/01/01');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'notes', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: '01', isPageName: false },
        { type: 'segment', text: '01', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/notes/2024/01/01');
    });

    it('treats a short trailing-year path as two units without bundling (/notes/2024)', () => {
      const result = formatTruncatedPagePath('/notes/2024');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'notes', isPageName: false },
        { type: 'segment', text: '2024', isPageName: true },
      ]);
    });

    it('page name text always matches DevidedPagePath.latter for a bundled date', () => {
      const result = formatTruncatedPagePath('/Projects/team/notes/2024/01/01');

      const lastPart = result.parts[result.parts.length - 1];
      expect(lastPart).toEqual({
        type: 'segment',
        text: '2024/01/01',
        isPageName: true,
      });
    });
  });

  describe('content preservation and normalization', () => {
    it('preserves long CJK segment content verbatim, even when truncated', () => {
      const cjkPageName = 'データベース設計'.repeat(10);
      const result = formatTruncatedPagePath(`/A/B/C/${cjkPageName}`);

      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: 'C', isPageName: false },
        { type: 'segment', text: cjkPageName, isPageName: true },
      ]);
    });

    it('preserves a long CJK ancestor verbatim in a short path', () => {
      const cjkAncestor = '親フォルダ'.repeat(10);
      const result = formatTruncatedPagePath(`/${cjkAncestor}/ページ`);

      expect(result.parts).toEqual([
        { type: 'segment', text: cjkAncestor, isPageName: false },
        { type: 'segment', text: 'ページ', isPageName: true },
      ]);
    });

    it('normalizes a trailing slash so /A/B/C/ behaves like /A/B/C', () => {
      const withTrailing = formatTruncatedPagePath('/A/B/C/');
      const withoutTrailing = formatTruncatedPagePath('/A/B/C');

      expect(withTrailing).toEqual(withoutTrailing);
      expect(withTrailing.fullPath).toBe('/A/B/C');
    });
  });

  describe('purity', () => {
    it('returns the same output for the same input', () => {
      const first = formatTruncatedPagePath('/A/B/C/D');
      const second = formatTruncatedPagePath('/A/B/C/D');

      expect(first).toEqual(second);
    });
  });
});
