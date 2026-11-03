import { describe, expect, it } from 'vitest';

import { buildAttachmentSearchQuery } from './build-attachment-search-query';
import { EMPTY_ATTACHMENT_KEYWORD_TERMS } from './split-query-terms';

const kw = (...match: string[]) => ({
  ...EMPTY_ATTACHMENT_KEYWORD_TERMS,
  match,
});

describe('buildAttachmentSearchQuery', () => {
  it('returns a valid ES request body object', () => {
    const body = buildAttachmentSearchQuery(kw('hello'));
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('contains a query with multi_match on content fields', () => {
    const body = buildAttachmentSearchQuery(kw('hello')) as any;
    const query = body.query;
    expect(query).toBeDefined();
    // Should have a bool or multi_match structure
    expect(query.bool ?? query.multi_match).toBeDefined();
  });

  it('matches content, content.ja, content.en fields', () => {
    const body = buildAttachmentSearchQuery(kw('test')) as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('content');
    expect(bodyStr).toContain('content.ja');
    expect(bodyStr).toContain('content.en');
  });

  it('matches fileName and originalName fields', () => {
    const body = buildAttachmentSearchQuery(kw('test')) as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('fileName');
    expect(bodyStr).toContain('originalName');
  });

  it('does NOT include permission filter fields (grant, granted_users, etc.)', () => {
    const body = buildAttachmentSearchQuery(kw('test')) as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('grant');
    expect(bodyStr).not.toContain('granted_users');
    expect(bodyStr).not.toContain('granted_groups');
    expect(bodyStr).not.toContain('creator');
  });

  it('does NOT include highlight by default', () => {
    const body = buildAttachmentSearchQuery(kw('test')) as any;
    expect(body.highlight).toBeUndefined();
  });

  it('includes highlight when highlight=true', () => {
    const body = buildAttachmentSearchQuery(kw('test'), {
      highlight: true,
    }) as any;
    expect(body.highlight).toBeDefined();
    // Should use em tags
    const highlightStr = JSON.stringify(body.highlight);
    expect(highlightStr).toContain('<em');
    expect(highlightStr).toContain('</em>');
  });

  it('uses default size and from when not provided', () => {
    const body = buildAttachmentSearchQuery(kw('test')) as any;
    expect(typeof body.size).toBe('number');
    expect(typeof body.from).toBe('number');
  });

  it('respects custom size option', () => {
    const body = buildAttachmentSearchQuery(kw('test'), { size: 5 }) as any;
    expect(body.size).toBe(5);
  });

  it('respects custom from option', () => {
    const body = buildAttachmentSearchQuery(kw('test'), { from: 10 }) as any;
    expect(body.from).toBe(10);
  });

  it('never asks Elasticsearch for the hit count (it counts hits before the permission check)', () => {
    const body = buildAttachmentSearchQuery(kw('test'));
    expect(body.track_total_hits).toBe(false);
  });

  it('matches snapshot (default options)', () => {
    const body = buildAttachmentSearchQuery(kw('hello', 'world'));
    expect(body).toMatchSnapshot();
  });

  it('matches snapshot (with highlight)', () => {
    const body = buildAttachmentSearchQuery(kw('hello', 'world'), {
      highlight: true,
      size: 10,
      from: 0,
    });
    expect(body).toMatchSnapshot();
  });
});
