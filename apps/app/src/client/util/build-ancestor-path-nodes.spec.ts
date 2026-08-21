import { buildAncestorPathNodes } from './build-ancestor-path-nodes';

describe('buildAncestorPathNodes', () => {
  describe('when the path is the root', () => {
    it.each([
      '/',
      '',
    ])('returns hasAncestors: false and no nodes for %j', (path) => {
      const result = buildAncestorPathNodes(path);

      expect(result.hasAncestors).toBe(false);
      expect(result.nodes).toEqual([]);
    });
  });

  describe('when the path has no ancestors (only a page name)', () => {
    it('returns hasAncestors: false and no nodes', () => {
      const result = buildAncestorPathNodes('/A');

      expect(result.hasAncestors).toBe(false);
      expect(result.nodes).toEqual([]);
      expect(result.fullPath).toBe('/A');
    });
  });

  describe('when the unit count is 3 or fewer (no truncation)', () => {
    it('returns every ancestor as a link node, in root-to-leaf order', () => {
      // No highlightedPath given: the highlighted chain falls back to `path` itself,
      // so its length always matches the plain chain and highlightedHtml mirrors the
      // plain text (mirrors PageListItemL's existing unconditional dual-tree pattern).
      const result = buildAncestorPathNodes('/A/B/C');

      expect(result.hasAncestors).toBe(true);
      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A', highlightedHtml: 'A' },
        { type: 'link', href: '/A/B', text: 'B', highlightedHtml: 'B' },
      ]);
      expect(result.fullPath).toBe('/A/B/C');
    });
  });

  describe('when the unit count is 4 or more (truncated)', () => {
    it('returns only the first ancestor and the immediate parent, with an ellipsis between them', () => {
      const result = buildAncestorPathNodes('/A/B/C/D');

      expect(result.hasAncestors).toBe(true);
      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A', highlightedHtml: 'A' },
        { type: 'ellipsis' },
        { type: 'link', href: '/A/B/C', text: 'C', highlightedHtml: 'C' },
      ]);
      expect(result.fullPath).toBe('/A/B/C/D');
    });
  });

  describe('when a highlightedPath is provided and the chain lengths match', () => {
    it("sets highlightedHtml only on surviving link nodes, reflecting each node's own highlight markup", () => {
      const result = buildAncestorPathNodes('/A/B/C/D', '/A/B/<em>C</em>/D');

      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A', highlightedHtml: 'A' },
        { type: 'ellipsis' },
        {
          type: 'link',
          href: '/A/B/C',
          text: 'C',
          highlightedHtml: '<em>C</em>',
        },
      ]);
    });

    it('applies highlightedHtml across every surviving node in the untruncated case', () => {
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
        { type: 'link', href: '/foo/bar', text: 'bar', highlightedHtml: 'bar' },
      ]);
    });
  });

  describe('when the plain and highlighted chains have a different total length', () => {
    it('falls back to the plain ancestor path with no highlightedHtml on any node', () => {
      const result = buildAncestorPathNodes('/A/B/C/D', '/X/Y');

      expect(result.hasAncestors).toBe(true);
      expect(result.nodes).toEqual([
        { type: 'link', href: '/A', text: 'A' },
        { type: 'ellipsis' },
        { type: 'link', href: '/A/B/C', text: 'C' },
      ]);
      expect(result.fullPath).toBe('/A/B/C/D');
    });
  });

  describe('fullPath', () => {
    it('always includes the page name, delegating to formatTruncatedPagePath', () => {
      const result = buildAncestorPathNodes('/A/B/C/D');

      expect(result.fullPath).toBe('/A/B/C/D');
    });
  });
});
