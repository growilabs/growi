import { selectMarkdownOccurrence } from './markdown-occurrence';

describe('selectMarkdownOccurrence', () => {
  const body = 'alpha target beta\ngamma\n\nlast target delta';
  const firstOffset = body.indexOf('target');
  const secondOffset = body.lastIndexOf('target');

  it('reports not-found when the quote does not occur in the body', () => {
    expect(selectMarkdownOccurrence(body, 'missing')).toEqual({
      kind: 'not-found',
    });
  });

  it('selects the only occurrence when no offset is given', () => {
    expect(selectMarkdownOccurrence(body, 'gamma')).toEqual({
      kind: 'selected',
      range: { start: 18, end: 23 },
    });
  });

  it('refuses several occurrences without an offset, listing every candidate with its offset, line and surrounding text', () => {
    const result = selectMarkdownOccurrence(body, 'target');

    expect(result).toEqual({
      kind: 'ambiguous',
      total: 2,
      candidates: [
        {
          offset: firstOffset,
          line: 1,
          snippet: expect.stringContaining('alpha target beta'),
        },
        {
          offset: secondOffset,
          line: 4,
          snippet: expect.stringContaining('last target delta'),
        },
      ],
    });
  });

  it('keeps each snippet short even when the body around the occurrence is long', () => {
    const longBody = `${'x'.repeat(500)} target ${'y'.repeat(500)} target`;

    const result = selectMarkdownOccurrence(longBody, 'target');

    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    for (const candidate of result.candidates) {
      expect(candidate.snippet).toContain('target');
      expect(candidate.snippet.length).toBeLessThan(100);
    }
  });

  it('counts occurrences without overlap', () => {
    expect(selectMarkdownOccurrence('aaa', 'aa')).toEqual({
      kind: 'selected',
      range: { start: 0, end: 2 },
    });
    expect(selectMarkdownOccurrence('aaaa', 'aa')).toEqual({
      kind: 'ambiguous',
      total: 2,
      candidates: [
        expect.objectContaining({ offset: 0 }),
        expect.objectContaining({ offset: 2 }),
      ],
    });
  });

  it('lists at most the first 20 occurrences, with the total count, however many there are', () => {
    const manyBody = 'x\n'.repeat(50_000);

    const result = selectMarkdownOccurrence(manyBody, 'x');

    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.total).toBe(50_000);
    expect(result.candidates).toHaveLength(20);
    expect(result.candidates[19]).toMatchObject({ offset: 38, line: 20 });
  });

  it('truncates a long match in the snippet', () => {
    const longQuote = 'q'.repeat(1000);
    const longBody = `before ${longQuote} middle ${longQuote} after`;

    const result = selectMarkdownOccurrence(longBody, longQuote);

    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    for (const candidate of result.candidates) {
      expect(candidate.snippet.length).toBeLessThan(200);
    }
    expect(result.candidates[0].snippet).toContain('before ');
    expect(result.candidates[1].snippet).toContain(' after');
  });

  it('accepts the offset of any occurrence beyond the listed ones', () => {
    const manyBody = 'x\n'.repeat(100);

    expect(selectMarkdownOccurrence(manyBody, 'x', 180)).toEqual({
      kind: 'selected',
      range: { start: 180, end: 181 },
    });
  });

  it('selects the occurrence that starts exactly at the given offset', () => {
    expect(selectMarkdownOccurrence(body, 'target', secondOffset)).toEqual({
      kind: 'selected',
      range: { start: secondOffset, end: secondOffset + 'target'.length },
    });
  });

  it('accepts the offset of a single occurrence too', () => {
    expect(selectMarkdownOccurrence(body, 'gamma', 18)).toEqual({
      kind: 'selected',
      range: { start: 18, end: 23 },
    });
  });

  it('refuses an offset at which no occurrence starts, listing the candidates', () => {
    expect(selectMarkdownOccurrence(body, 'target', firstOffset + 1)).toEqual({
      kind: 'offset-mismatch',
      total: 2,
      candidates: [
        expect.objectContaining({ offset: firstOffset, line: 1 }),
        expect.objectContaining({ offset: secondOffset, line: 4 }),
      ],
    });
  });

  it('reports not-found rather than an offset mismatch when the quote never occurs', () => {
    expect(selectMarkdownOccurrence(body, 'missing', 3)).toEqual({
      kind: 'not-found',
    });
  });

  it('matches the markdown literally, markup included', () => {
    const markdown = 'plain bold and **bold** text';

    expect(selectMarkdownOccurrence(markdown, '**bold**')).toEqual({
      kind: 'selected',
      range: { start: 15, end: 23 },
    });
  });
});
