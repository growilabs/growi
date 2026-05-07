import { describe, expect, it } from 'vitest';

import { buildAttachmentSearchQuery } from './build-attachment-search-query';

describe('buildAttachmentSearchQuery', () => {
  it('returns a valid ES request body object', () => {
    const body = buildAttachmentSearchQuery('hello');
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('contains a query with multi_match on content fields', () => {
    const body = buildAttachmentSearchQuery('hello') as any;
    const query = body.query;
    expect(query).toBeDefined();
    // Should have a bool or multi_match structure
    expect(query.bool ?? query.multi_match).toBeDefined();
  });

  it('matches content, content.ja, content.en fields', () => {
    const body = buildAttachmentSearchQuery('test') as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('content');
    expect(bodyStr).toContain('content.ja');
    expect(bodyStr).toContain('content.en');
  });

  it('matches fileName and originalName fields', () => {
    const body = buildAttachmentSearchQuery('test') as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain('fileName');
    expect(bodyStr).toContain('originalName');
  });

  it('does NOT include permission filter fields (grant, granted_users, etc.)', () => {
    const body = buildAttachmentSearchQuery('test') as any;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('grant');
    expect(bodyStr).not.toContain('granted_users');
    expect(bodyStr).not.toContain('granted_groups');
    expect(bodyStr).not.toContain('creator');
  });

  it('does NOT include highlight by default', () => {
    const body = buildAttachmentSearchQuery('test') as any;
    expect(body.highlight).toBeUndefined();
  });

  it('includes highlight when highlight=true', () => {
    const body = buildAttachmentSearchQuery('test', { highlight: true }) as any;
    expect(body.highlight).toBeDefined();
    // Should use em tags
    const highlightStr = JSON.stringify(body.highlight);
    expect(highlightStr).toContain('<em');
    expect(highlightStr).toContain('</em>');
  });

  it('uses default size and from when not provided', () => {
    const body = buildAttachmentSearchQuery('test') as any;
    expect(typeof body.size).toBe('number');
    expect(typeof body.from).toBe('number');
  });

  it('respects custom size option', () => {
    const body = buildAttachmentSearchQuery('test', { size: 5 }) as any;
    expect(body.size).toBe(5);
  });

  it('respects custom from option', () => {
    const body = buildAttachmentSearchQuery('test', { from: 10 }) as any;
    expect(body.from).toBe(10);
  });

  it('matches snapshot (default options)', () => {
    const body = buildAttachmentSearchQuery('hello world');
    expect(body).toMatchSnapshot();
  });

  it('matches snapshot (with highlight)', () => {
    const body = buildAttachmentSearchQuery('hello world', {
      highlight: true,
      size: 10,
      from: 0,
    });
    expect(body).toMatchSnapshot();
  });
});
