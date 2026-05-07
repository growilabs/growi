import { describe, expect, it } from 'vitest';

import { mgetPagesForPermissionBody } from './mget-pages-for-permission-body';

describe('mgetPagesForPermissionBody', () => {
  const samplePageIds = ['id1', 'id2', 'id3'];

  it('returns a valid object', () => {
    const body = mgetPagesForPermissionBody(samplePageIds);
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('includes the page ids in the body', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body.ids).toEqual(samplePageIds);
  });

  it('includes _source with includes array', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source).toBeDefined();
    expect(body._source.includes).toBeDefined();
    expect(Array.isArray(body._source.includes)).toBe(true);
  });

  it('includes _id in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('_id');
  });

  it('includes grant in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('grant');
  });

  it('includes grantedUsers in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('grantedUsers');
  });

  it('includes grantedGroups in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('grantedGroups');
  });

  it('includes creator in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('creator');
  });

  it('includes path in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('path');
  });

  it('includes title in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('title');
  });

  it('includes updatedAt in _source.includes', () => {
    const body = mgetPagesForPermissionBody(samplePageIds) as any;
    expect(body._source.includes).toContain('updatedAt');
  });

  it('works with empty array', () => {
    const body = mgetPagesForPermissionBody([]) as any;
    expect(body.ids).toEqual([]);
    expect(body._source.includes).toBeDefined();
  });

  it('matches snapshot', () => {
    const body = mgetPagesForPermissionBody(samplePageIds);
    expect(body).toMatchSnapshot();
  });
});
