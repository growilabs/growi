import { buildAncestorPathNodes } from './build-ancestor-path-nodes';
import { formatTruncatedPagePath } from './format-truncated-page-path';

describe('buildAncestorPathNodes', () => {
  describe('when the path is the root', () => {
    it.each(['/', ''])('returns no nodes for %j', (path) => {
      const result = buildAncestorPathNodes(path);

      expect(result.nodes).toEqual([]);
    });
  });

  describe('when the path has no ancestors (only a page name)', () => {
    it('returns no nodes', () => {
      const result = buildAncestorPathNodes('/A');

      expect(result.nodes).toEqual([]);
      expect(result.fullPath).toBe('/A');
    });
  });

  describe('when the unit count is 3 or fewer (no truncation)', () => {
    it('returns every ancestor as a link node, in root-to-leaf order', () => {
      const result = buildAncestorPathNodes('/A/B/C');

      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A' },
        { type: 'link', href: '/A/B', text: 'B' },
      ]);
      expect(result.fullPath).toBe('/A/B/C');
    });
  });

  describe('when the unit count is 4 or more (truncated)', () => {
    it('returns only the first ancestor and the immediate parent, with an ellipsis between them', () => {
      const result = buildAncestorPathNodes('/A/B/C/D');

      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A' },
        { type: 'ellipsis' },
        { type: 'link', href: '/A/B/C', text: 'C' },
      ]);
      expect(result.fullPath).toBe('/A/B/C/D');
    });
  });

  describe('when a highlightedPath is provided and the chain lengths match', () => {
    it("sets highlightedHtml only on surviving link nodes, reflecting each node's own highlight markup", () => {
      const result = buildAncestorPathNodes('/A/B/C/D', '/A/B/<em>C</em>/D');

      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A' },
        { type: 'ellipsis' },
        {
          type: 'link',
          href: '/A/B/C',
          text: 'C',
          highlightedHtml: '<em>C</em>',
        },
      ]);
    });

    it('sets highlightedHtml only on the segments that carry a highlight', () => {
      const result = buildAncestorPathNodes(
        '/foo/bar/baz',
        '/<em>foo</em>/bar/baz',
      );

      expect(result.nodes).toEqual([
        {
          type: 'link',
          href: '/foo',
          text: 'foo',
          highlightedHtml: '<em>foo</em>',
        },
        { type: 'link', href: '/foo/bar', text: 'bar' },
      ]);
    });
  });

  describe('when the highlight markup contains a "/" of its own', () => {
    it('renders only the segments whose <em> is cut by a "/" as plain text', () => {
      const result = buildAncestorPathNodes(
        '/A/B/C/D',
        "/A/<em class='highlighted-keyword'>B/C</em>/D",
      );

      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A' },
        { type: 'ellipsis' },
        { type: 'link', href: '/A/B/C', text: 'C' },
      ]);
    });

    it('keeps an ancestor highlight on a date-suffixed path', () => {
      // The `/` of `</em>` used to be picked up by the date-bundling regex,
      // desyncing the highlighted chain and dropping every ancestor highlight.
      const result = buildAncestorPathNodes(
        '/daily/2024/01/02',
        "/<em class='highlighted-keyword'>daily</em>/2024/01/02",
      );

      expect(result.nodes).toEqual([
        {
          type: 'link',
          href: '/daily',
          text: 'daily',
          highlightedHtml: "<em class='highlighted-keyword'>daily</em>",
        },
        { type: 'ellipsis' },
        { type: 'link', href: '/daily/2024/01', text: '01' },
      ]);
    });
  });

  describe('when a collapse level is given', () => {
    it.each([
      {
        path: '/A/B/C/D',
        level: 1,
        expected: [
          { type: 'ellipsis' },
          { type: 'link', href: '/A/B/C', text: 'C' },
        ],
      },
      { path: '/A/B/C/D', level: 2, expected: [{ type: 'ellipsis' }] },
      {
        path: '/A/B/C',
        level: 1,
        expected: [
          { type: 'ellipsis' },
          { type: 'link', href: '/A/B', text: 'B' },
        ],
      },
      { path: '/A/B/C', level: 2, expected: [{ type: 'ellipsis' }] },
      { path: '/A/B', level: 1, expected: [{ type: 'ellipsis' }] },
      {
        path: '/daily/2024/01/02',
        level: 1,
        expected: [
          { type: 'ellipsis' },
          { type: 'link', href: '/daily/2024/01', text: '01' },
        ],
      },
    ])('folds $path at level $level, keeping each survivor linked to its own ancestor', ({
      path,
      level,
      expected,
    }) => {
      const result = buildAncestorPathNodes(path, null, level);

      expect(result.nodes).toEqual(expected);
      expect(result.fullPath).toBe(path);
    });

    it('keeps the highlight on the surviving parent and drops it with the folded ancestors', () => {
      const result = buildAncestorPathNodes(
        '/foo/bar/baz',
        '/<em>foo</em>/<em>bar</em>/baz',
        1,
      );

      expect(result.nodes).toEqual([
        { type: 'ellipsis' },
        {
          type: 'link',
          href: '/foo/bar',
          text: 'bar',
          highlightedHtml: '<em>bar</em>',
        },
      ]);
    });

    it('treats a level beyond the maximum as the maximum', () => {
      const result = buildAncestorPathNodes('/A/B/C/D', null, 5);

      expect(result.nodes).toEqual([{ type: 'ellipsis' }]);
    });

    it.each(['/', '/A'])('still returns no nodes for %j', (path) => {
      const result = buildAncestorPathNodes(path, null, 1);

      expect(result.nodes).toEqual([]);
    });
  });

  describe('maxCollapseLevel', () => {
    it.each([
      { path: '/', expected: 0 },
      { path: '/A', expected: 0 },
      { path: '/A/B', expected: 1 },
      { path: '/A/B/C', expected: 2 },
      { path: '/A/B/C/D/E', expected: 2 },
    ])('is $expected for $path, matching formatTruncatedPagePath so both screens share one level scale', ({
      path,
      expected,
    }) => {
      const result = buildAncestorPathNodes(path);

      expect(result.maxCollapseLevel).toBe(expected);
      expect(result.maxCollapseLevel).toBe(
        formatTruncatedPagePath(path).maxCollapseLevel,
      );
    });
  });

  describe('fullPath', () => {
    it('always includes the page name, delegating to formatTruncatedPagePath', () => {
      const result = buildAncestorPathNodes('/A/B/C/D');

      expect(result.fullPath).toBe('/A/B/C/D');
    });
  });
});
