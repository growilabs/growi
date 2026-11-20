import {
  formatTruncatedPagePath,
  type PagePathPart,
  parsePagePath,
  type TruncatedPagePath,
} from './format-truncated-page-path';

const format = (path: string, collapseLevel?: number): TruncatedPagePath =>
  formatTruncatedPagePath(parsePagePath(path), collapseLevel);

describe('parsePagePath', () => {
  it('decides the maximum collapse level from the ancestors visible in the base form', () => {
    expect(parsePagePath('/').maxCollapseLevel).toBe(0);
    expect(parsePagePath('/leaf').maxCollapseLevel).toBe(0);
    expect(parsePagePath('/a/leaf').maxCollapseLevel).toBe(1);
    expect(parsePagePath('/a/b/leaf').maxCollapseLevel).toBe(2);
    expect(parsePagePath('/a/b/c/d/leaf').maxCollapseLevel).toBe(2);
  });

  it('keeps the given path as is while normalizing the full path', () => {
    const parsed = parsePagePath('/A/B/C/');

    expect(parsed.path).toBe('/A/B/C/');
    expect(parsed.fullPath).toBe('/A/B/C');
  });
});

describe('formatTruncatedPagePath', () => {
  describe('root paths', () => {
    it.each(['/', ''])('returns isRoot with empty parts for %p', (path) => {
      const result = format(path);

      expect(result.isRoot).toBe(true);
      expect(result.parts).toEqual([]);
      expect(result.fullPath).toBe('/');
    });
  });

  describe('short paths (units <= 3): every unit shown, no ellipsis', () => {
    it('shows only the page name for a single-unit path (/A)', () => {
      const result = format('/A');

      expect(result.isRoot).toBe(false);
      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/A');
    });

    it('shows one ancestor + page name for a two-unit path (/A/B)', () => {
      const result = format('/A/B');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'segment', text: 'B', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/A/B');
    });

    it('shows all three units for a three-unit path (/A/B/C)', () => {
      const result = format('/A/B/C');

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
      const result = format('/A/B/C/D');

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
      const result = format('/A/B/C/D/E/F/G');

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
      const result = format('/Projects/team/notes/2024/01/01');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'Projects', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: 'notes', isPageName: false },
        { type: 'segment', text: '2024/01/01', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/Projects/team/notes/2024/01/01');
      // The ancestor portion excludes the bundled date, so callers walking the
      // ancestors never see '2024' / '01' as ancestors.
      expect(result.ancestorPath).toBe('/Projects/team/notes');
    });

    it('does NOT bundle a trailing date when only one ancestor segment precedes it', () => {
      // Documents actual DevidedPagePath behavior: /notes/2024/01/01 leaves the
      // ancestor part '/notes' (single segment), so the date pattern does not match
      // and the last path element '01' becomes the page name. ancestors = [notes, 2024, 01].
      const result = format('/notes/2024/01/01');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'notes', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: '01', isPageName: false },
        { type: 'segment', text: '01', isPageName: true },
      ]);
      expect(result.fullPath).toBe('/notes/2024/01/01');
      expect(result.ancestorPath).toBe('/notes/2024/01');
    });

    it('treats a short trailing-year path as two units without bundling (/notes/2024)', () => {
      const result = format('/notes/2024');

      expect(result.parts).toEqual([
        { type: 'segment', text: 'notes', isPageName: false },
        { type: 'segment', text: '2024', isPageName: true },
      ]);
    });

    it('page name text always matches DevidedPagePath.latter for a bundled date', () => {
      const result = format('/Projects/team/notes/2024/01/01');

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
      const result = format(`/A/B/C/${cjkPageName}`);

      expect(result.parts).toEqual([
        { type: 'segment', text: 'A', isPageName: false },
        { type: 'ellipsis' },
        { type: 'segment', text: 'C', isPageName: false },
        { type: 'segment', text: cjkPageName, isPageName: true },
      ]);
    });

    it('preserves a long CJK ancestor verbatim in a short path', () => {
      const cjkAncestor = '親フォルダ'.repeat(10);
      const result = format(`/${cjkAncestor}/ページ`);

      expect(result.parts).toEqual([
        { type: 'segment', text: cjkAncestor, isPageName: false },
        { type: 'segment', text: 'ページ', isPageName: true },
      ]);
    });

    it('normalizes a trailing slash so /A/B/C/ behaves like /A/B/C', () => {
      const withTrailing = format('/A/B/C/');
      const withoutTrailing = format('/A/B/C');

      expect(withTrailing).toEqual(withoutTrailing);
      expect(withTrailing.fullPath).toBe('/A/B/C');
    });
  });

  describe('collapse levels (ancestors folded from the root side, parent last)', () => {
    const seg = (text: string, isPageName = false): PagePathPart => ({
      type: 'segment',
      text,
      isPageName,
    });
    const ELLIPSIS: PagePathPart = { type: 'ellipsis' };

    it.each<[string, number, readonly PagePathPart[][]]>([
      [
        '/a/b/c/d/leaf',
        2,
        [
          [seg('a'), ELLIPSIS, seg('d'), seg('leaf', true)],
          [ELLIPSIS, seg('d'), seg('leaf', true)],
          [ELLIPSIS, seg('leaf', true)],
        ],
      ],
      [
        '/a/b/c/leaf',
        2,
        [
          [seg('a'), ELLIPSIS, seg('c'), seg('leaf', true)],
          [ELLIPSIS, seg('c'), seg('leaf', true)],
          [ELLIPSIS, seg('leaf', true)],
        ],
      ],
      [
        '/a/b/leaf',
        2,
        [
          [seg('a'), seg('b'), seg('leaf', true)],
          [ELLIPSIS, seg('b'), seg('leaf', true)],
          [ELLIPSIS, seg('leaf', true)],
        ],
      ],
      [
        '/a/leaf',
        1,
        [
          [seg('a'), seg('leaf', true)],
          [ELLIPSIS, seg('leaf', true)],
        ],
      ],
      ['/leaf', 0, [[seg('leaf', true)]]],
    ])('%s: maxCollapseLevel %i and the shape at each level', (path, max, expectedByLevel) => {
      expect(format(path).maxCollapseLevel).toBe(max);

      expectedByLevel.forEach((expected, level) => {
        const result = format(path, level);
        expect(result.parts).toEqual(expected);
        expect(result.maxCollapseLevel).toBe(max);
        expect(
          result.parts.filter((p) => p.type === 'ellipsis').length,
        ).toBeLessThanOrEqual(1);
      });
    });

    it('returns maxCollapseLevel 0 and empty parts for the root at any level', () => {
      const result = format('/', 2);

      expect(result.isRoot).toBe(true);
      expect(result.parts).toEqual([]);
      expect(result.maxCollapseLevel).toBe(0);
    });

    it('keeps a bundled trailing date as the page name when folding', () => {
      const result = format('/Projects/team/notes/2024/01/01', 2);

      expect(result.parts).toEqual([ELLIPSIS, seg('2024/01/01', true)]);
    });

    it.each([
      '/a/b/c/d/e/f/leaf',
      '/a/b/c/leaf',
      '/a/b/leaf',
    ])('%s: ancestors after the ellipsis are the tail of the original chain at every level', (path) => {
      const ancestorTexts = format(path)
        .ancestorPath.split('/')
        .filter(Boolean);

      // Levels 1 and 2 fold from the root side, so the path starts with the ellipsis.
      [1, 2].forEach((level) => {
        const { parts } = format(path, level);
        expect(parts[0]).toEqual(ELLIPSIS);

        const shownAncestors = parts
          .slice(1, -1)
          .map((p) => (p.type === 'segment' ? p.text : '…'));
        expect(shownAncestors).toEqual(
          ancestorTexts.slice(ancestorTexts.length - (2 - level)),
        );
      });
    });

    it('clamps an out-of-range level into 0..maxCollapseLevel', () => {
      expect(format('/a/b/c/d/leaf', 99).parts).toEqual([
        ELLIPSIS,
        seg('leaf', true),
      ]);
      expect(format('/a/leaf', 5).parts).toEqual([ELLIPSIS, seg('leaf', true)]);
      expect(format('/a/b/c/d/leaf', -1).parts).toEqual([
        seg('a'),
        ELLIPSIS,
        seg('d'),
        seg('leaf', true),
      ]);
      expect(format('/leaf', 3).parts).toEqual([seg('leaf', true)]);
    });

    it('treats a non-integer level as a whole level', () => {
      const base = format('/a/b/c/d/leaf', 0).parts;
      expect(format('/a/b/c/d/leaf', Number.NaN).parts).toEqual(base);
      expect(format('/a/b/c/d/leaf', 0.5).parts).toEqual(base);
      expect(format('/a/b/c/d/leaf', 1.5).parts).toEqual(
        format('/a/b/c/d/leaf', 1).parts,
      );
    });

    it('returns the base form when no level is given', () => {
      expect(format('/a/b/c/d/leaf')).toEqual(format('/a/b/c/d/leaf', 0));
    });
  });

  describe('purity', () => {
    it('returns the same output for the same input', () => {
      const first = format('/A/B/C/D');
      const second = format('/A/B/C/D');

      expect(first).toEqual(second);
    });
  });
});
