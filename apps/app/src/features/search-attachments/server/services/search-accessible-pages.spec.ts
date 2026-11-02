import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import type { SearchQuery } from '~/server/service/search-delegator/elasticsearch-client-delegator';

import {
  createSearchAccessiblePages,
  type PageIndexSearchFn,
  type PageIndexSearchResponse,
} from './search-accessible-pages';

const ownerId = new mongoose.Types.ObjectId().toString();
const groupId = new mongoose.Types.ObjectId();
const owner = mock<IUserHasId>({ _id: ownerId });

type Hit = PageIndexSearchResponse['hits']['hits'][number];

const hit = (
  id: string,
  grant: number,
  grantedUsers: string[] = [],
  grantedGroups: string[] = [],
): Hit => ({
  _id: id,
  _source: {
    path: `/${id}`,
    grant,
    granted_users: grantedUsers,
    granted_groups: grantedGroups,
    updated_at: '2026-01-01T00:00:00.000Z',
  },
});

const response = (
  hits: Hit[],
  extra: Partial<PageIndexSearchResponse> = {},
): PageIndexSearchResponse => ({
  timed_out: false,
  _shards: { total: 1, successful: 1, failed: 0 },
  hits: { hits },
  ...extra,
});

const makeDelegator = () => {
  const delegator =
    mock<
      Pick<ElasticsearchDelegator, 'createSearchQuery' | 'filterPagesByViewer'>
    >();
  delegator.createSearchQuery.mockImplementation(
    (): SearchQuery => ({
      index: 'pages-alias',
      _source: ['path'],
      body: { query: { bool: {} } },
    }),
  );
  delegator.filterPagesByViewer.mockImplementation((query) => {
    const bool = query.body?.query?.bool;
    if (bool != null) {
      Object.assign(bool, { filter: [{ term: { viewer: 'filter' } }] });
    }
  });
  return delegator;
};

describe('createSearchAccessiblePages', () => {
  it('applies the shared page-search viewer filter and restricts to the requested ids', async () => {
    const delegator = makeDelegator();
    const search = vi.fn<PageIndexSearchFn>().mockResolvedValue(response([]));
    const userGroups = [groupId];

    await createSearchAccessiblePages(delegator, search)(['p1', 'p2', 'p1'], {
      user: owner,
      userGroups,
    });

    expect(delegator.filterPagesByViewer).toHaveBeenCalledWith(
      expect.anything(),
      owner,
      userGroups,
    );
    const params = search.mock.calls[0][0];
    expect(params.index).toBe('pages-alias');
    expect(params.size).toBe(2);
    expect(JSON.stringify(params.query)).toContain('"viewer":"filter"');
    expect(params.query).toEqual({
      bool: expect.objectContaining({
        filter: expect.arrayContaining([{ ids: { values: ['p1', 'p2'] } }]),
      }),
    });
  });

  it('uses guest semantics (user null, no groups) for a guest viewer', async () => {
    const delegator = makeDelegator();
    const search = vi.fn<PageIndexSearchFn>().mockResolvedValue(response([]));

    await createSearchAccessiblePages(delegator, search)(['p1'], {
      user: null,
      userGroups: null,
    });

    expect(delegator.filterPagesByViewer).toHaveBeenCalledWith(
      expect.anything(),
      null,
      null,
    );
  });

  it('does not query when no ids are given', async () => {
    const search = vi.fn<PageIndexSearchFn>();

    const result = await createSearchAccessiblePages(makeDelegator(), search)(
      [],
      { user: null, userGroups: null },
    );

    expect(result).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps only pages whose content the viewer may see (the page-search snippet rule)', async () => {
    const search = vi
      .fn<PageIndexSearchFn>()
      .mockResolvedValue(
        response([
          hit('public', PageGrant.GRANT_PUBLIC),
          hit('mine', PageGrant.GRANT_OWNER, [ownerId]),
          hit('others', PageGrant.GRANT_OWNER, ['someone-else']),
          hit('my-group', PageGrant.GRANT_USER_GROUP, [], [groupId.toString()]),
          hit('other-group', PageGrant.GRANT_USER_GROUP, [], ['other-group']),
          hit('link-only', PageGrant.GRANT_RESTRICTED),
        ]),
      );

    const result = await createSearchAccessiblePages(makeDelegator(), search)(
      ['public', 'mine', 'others', 'my-group', 'other-group', 'link-only'],
      { user: owner, userGroups: [groupId] },
    );

    expect(result.map((p) => p.pageId)).toEqual(['public', 'mine', 'my-group']);
    expect(result[0]).toEqual({
      pageId: 'public',
      path: '/public',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('never returns a page id that the page index did not return', async () => {
    const search = vi
      .fn<PageIndexSearchFn>()
      .mockResolvedValue(response([hit('p1', PageGrant.GRANT_PUBLIC)]));

    const result = await createSearchAccessiblePages(makeDelegator(), search)(
      ['p1', 'missing'],
      { user: null, userGroups: null },
    );

    expect(result.map((p) => p.pageId)).toEqual(['p1']);
  });

  it('rejects a response with failed shards instead of using a partial result', async () => {
    const search = vi.fn<PageIndexSearchFn>().mockResolvedValue(
      response([hit('p1', PageGrant.GRANT_PUBLIC)], {
        _shards: { total: 2, successful: 1, failed: 1 },
      }),
    );

    await expect(
      createSearchAccessiblePages(makeDelegator(), search)(['p1'], {
        user: null,
        userGroups: null,
      }),
    ).rejects.toThrow(/shard/);
  });

  it('rejects a timed-out response', async () => {
    const search = vi
      .fn<PageIndexSearchFn>()
      .mockResolvedValue(
        response([hit('p1', PageGrant.GRANT_PUBLIC)], { timed_out: true }),
      );

    await expect(
      createSearchAccessiblePages(makeDelegator(), search)(['p1'], {
        user: null,
        userGroups: null,
      }),
    ).rejects.toThrow(/timed out/);
  });

  it('propagates a search failure', async () => {
    const search = vi
      .fn<PageIndexSearchFn>()
      .mockRejectedValue(new Error('connection refused'));

    await expect(
      createSearchAccessiblePages(makeDelegator(), search)(['p1'], {
        user: null,
        userGroups: null,
      }),
    ).rejects.toThrow('connection refused');
  });
});
