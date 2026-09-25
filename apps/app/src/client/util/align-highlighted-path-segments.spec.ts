import {
  alignHighlightedPathSegments,
  buildHighlightedPageName,
} from './align-highlighted-path-segments';

// The markup Elasticsearch + the server-side FilterXSS actually produce.
const em = (text: string): string =>
  `<em class="highlighted-keyword">${text}</em>`;

describe('alignHighlightedPathSegments', () => {
  it('pairs each segment with its own highlight markup, root-first', () => {
    const result = alignHighlightedPathSegments(
      '/foo/bar/foo',
      `/${em('foo')}/bar/${em('foo')}`,
    );

    expect(result).toEqual([em('foo'), 'bar', em('foo')]);
  });

  it('does not treat the "/" of a closing </em> as a path separator', () => {
    const result = alignHighlightedPathSegments(
      '/A/B/C/D/E',
      `/${em('A')}/B/${em('C')}/D/${em('E')}`,
    );

    expect(result).toEqual([em('A'), 'B', em('C'), 'D', em('E')]);
  });

  it('keeps multiple highlights and surrounding text within one segment', () => {
    const result = alignHighlightedPathSegments(
      '/A & B/memo',
      `/${em('A')} & ${em('B')}/memo`,
    );

    expect(result).toEqual([`${em('A')} & ${em('B')}`, 'memo']);
  });

  it('falls back to plain text only for segments whose highlight crosses a "/"', () => {
    const result = alignHighlightedPathSegments('/A/B/C', `/A/${em('B/C')}`);

    expect(result).toEqual(['A', undefined, undefined]);
  });

  it('falls back to plain text everywhere when the segment counts differ', () => {
    const result = alignHighlightedPathSegments('/A/B/C', `/${em('A')}/B`);

    expect(result).toEqual([undefined, undefined, undefined]);
  });

  it('falls back to plain text for a segment whose text differs from the path', () => {
    const result = alignHighlightedPathSegments('/A/B', `/${em('A')}/X`);

    expect(result).toEqual([em('A'), undefined]);
  });

  it.each([
    undefined,
    null,
    '',
  ])('returns no markup when highlightedPath is %j', (highlightedPath) => {
    expect(alignHighlightedPathSegments('/A/B', highlightedPath)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('returns no segments for the root path', () => {
    expect(alignHighlightedPathSegments('/', '/')).toEqual([]);
  });
});

describe('buildHighlightedPageName', () => {
  it('returns the highlighted page name even when an ancestor is also highlighted', () => {
    expect(
      buildHighlightedPageName(
        '/foo/bar/foo',
        `/${em('foo')}/bar/${em('foo')}`,
      ),
    ).toBe(em('foo'));
  });

  it('bundles a trailing date and keeps the highlight inside it', () => {
    expect(
      buildHighlightedPageName(
        '/daily/memo/2024/01/02',
        `/daily/memo/2024/01/${em('02')}`,
      ),
    ).toBe(`2024/01/${em('02')}`);
  });

  it('keeps the bundled date intact when an ancestor of a date path is highlighted', () => {
    expect(
      buildHighlightedPageName(
        '/daily/memo/2024/01/02',
        `/${em('daily')}/memo/2024/01/02`,
      ),
    ).toBe('2024/01/02');
  });

  it('falls back to the plain page name when its highlight crosses a "/"', () => {
    expect(buildHighlightedPageName('/A/B/C', `/A/${em('B/C')}`)).toBe('C');
  });

  it('returns the plain page name when there is no highlight', () => {
    expect(buildHighlightedPageName('/A/B/2024/01/15')).toBe('2024/01/15');
  });

  it('returns "/" for the root path', () => {
    expect(buildHighlightedPageName('/')).toBe('/');
  });
});
