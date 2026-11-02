import { mgetPagesForPermissionBody } from './mget-pages-for-permission-body';

describe('mgetPagesForPermissionBody', () => {
  const samplePageIds = ['id1', 'id2', 'id3'];

  it('passes the page ids as the ids parameter', () => {
    expect(mgetPagesForPermissionBody(samplePageIds).ids).toEqual(
      samplePageIds,
    );
  });

  it('selects fields through the _source_includes parameter, never a top-level _source', () => {
    const params = mgetPagesForPermissionBody(samplePageIds);

    expect(params).not.toHaveProperty('_source');
    expect(params).not.toHaveProperty('body');
    expect(params._source_includes).toEqual(
      expect.arrayContaining([
        'path',
        'grant',
        'granted_users',
        'granted_groups',
      ]),
    );
  });

  it('never fetches the page body', () => {
    const params = mgetPagesForPermissionBody(samplePageIds);

    expect(params._source_includes).not.toContain('body');
    expect(params._source_includes).not.toContain('body_embedded');
  });

  it('works with an empty array', () => {
    expect(mgetPagesForPermissionBody([]).ids).toEqual([]);
  });

  it('matches snapshot', () => {
    expect(mgetPagesForPermissionBody(samplePageIds)).toMatchSnapshot();
  });
});
