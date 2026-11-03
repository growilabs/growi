import { describe, expect, it } from 'vitest';

import { buildAttachmentsByPageIdsQuery } from './build-attachments-by-page-ids-query';
import { EMPTY_ATTACHMENT_KEYWORD_TERMS } from './split-query-terms';

const kw = (...match: string[]) => ({
  ...EMPTY_ATTACHMENT_KEYWORD_TERMS,
  match,
});

describe('buildAttachmentsByPageIdsQuery', () => {
  const samplePageIds = ['page1', 'page2', 'page3'];

  it('returns a valid ES request body object', () => {
    const body = buildAttachmentsByPageIdsQuery(kw('hello'), samplePageIds);
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('includes a terms filter on pageId', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('hello'),
      samplePageIds,
    ) as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('pageId');
    expect(bodyStr).toContain('page1');
    expect(bodyStr).toContain('page2');
    expect(bodyStr).toContain('page3');
  });

  it('uses terms (plural) for pageId filter', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('hello'),
      samplePageIds,
    ) as any;
    const bodyStr = JSON.stringify(body);
    // Should use "terms" (not "term") for multi-value match
    expect(bodyStr).toContain('"terms"');
    expect(bodyStr).toContain('"pageId"');
  });

  it('includes content match query', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('hello'),
      samplePageIds,
    ) as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('content');
    expect(bodyStr).toContain('hello');
  });

  it('matches content.ja and content.en fields', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('test'),
      samplePageIds,
    ) as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('content.ja');
    expect(bodyStr).toContain('content.en');
  });

  it('does NOT include highlight by default', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('test'),
      samplePageIds,
    ) as any;
    expect(body.highlight).toBeUndefined();
  });

  it('includes highlight when highlight=true', () => {
    const body = buildAttachmentsByPageIdsQuery(kw('test'), samplePageIds, {
      highlight: true,
    }) as any;
    expect(body.highlight).toBeDefined();
    const highlightStr = JSON.stringify(body.highlight);
    expect(highlightStr).toContain('<em');
    expect(highlightStr).toContain('</em>');
  });

  it('respects custom size option', () => {
    const body = buildAttachmentsByPageIdsQuery(kw('test'), samplePageIds, {
      size: 5,
    }) as any;
    expect(body.size).toBe(5);
  });

  it('throws when pageIds.length exceeds DEFAULT_PAGE_SIZE (20)', () => {
    const oversizedPageIds = Array.from({ length: 21 }, (_, i) => `page${i}`);
    expect(() =>
      buildAttachmentsByPageIdsQuery(kw('test'), oversizedPageIds),
    ).toThrow();
  });

  it('does NOT throw when pageIds.length equals DEFAULT_PAGE_SIZE (20)', () => {
    const exactSizePageIds = Array.from({ length: 20 }, (_, i) => `page${i}`);
    expect(() =>
      buildAttachmentsByPageIdsQuery(kw('test'), exactSizePageIds),
    ).not.toThrow();
  });

  it('does NOT throw with empty pageIds array', () => {
    expect(() => buildAttachmentsByPageIdsQuery(kw('test'), [])).not.toThrow();
  });

  it('never asks Elasticsearch for the hit count', () => {
    const body = buildAttachmentsByPageIdsQuery(kw('test'), samplePageIds);
    expect(body.track_total_hits).toBe(false);
  });

  it('matches snapshot', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('hello', 'world'),
      samplePageIds,
    );
    expect(body).toMatchSnapshot();
  });

  it('matches snapshot with highlight', () => {
    const body = buildAttachmentsByPageIdsQuery(
      kw('hello', 'world'),
      samplePageIds,
      {
        highlight: true,
        size: 10,
      },
    );
    expect(body).toMatchSnapshot();
  });
});
