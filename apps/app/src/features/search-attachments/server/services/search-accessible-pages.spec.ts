import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import type { SearchQuery } from '~/server/service/search-delegator/elasticsearch-client-delegator';

import {
  createSearchAccessiblePages,
  type FindSnippetVisiblePageIdsFn,
  type PageIndexSearchFn,
  type PageIndexSearchResponse,
  type PageSearchFilter,
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

const NO_FILTER: PageSearchFilter = {
  terms: {
    prefix: [],
    not_prefix: [],
    tag: [],
    not_tag: [],
    author: [],
    not_author: [],
    editor: [],
    not_editor: [],
    group: [],
    not_group: [],
  },
  resolvedFilterData: { groupIds: [], notGroupIds: [] },
};

// MongoDB agrees with the page index unless a test says otherwise.
const mongoAllowsAll: FindSnippetVisiblePageIdsFn = async (ids) => new Set(ids);

const makeDelegator = () => {
  const delegator =
    mock<
      Pick<
        ElasticsearchDelegator,
        | 'createSearchQuery'
        | 'appendCriteriaForQueryString'
        | 'appendCriteriaForGroupFilter'
        | 'filterPagesByViewer'
      >
    >();
  delegator.createSearchQuery.mockImplementation(
    (): SearchQuery => ({
      index: 'pages-alias',
      _source: ['path'],
      body: { query: { bool: {} } },
    }),
  );
  delegator.appendCriteriaForQueryString.mockImplementation((query, terms) => {
    const bool = query.body?.query?.bool;
    if (bool != null) {
      Object.assign(bool, {
        filter: [{ term: { operators: terms.prefix.join(',') } }],
        must_not: [{ term: { not_prefix: terms.not_prefix.join(',') } }],
      });
    }
  });
  delegator.filterPagesByViewer.mockImplementation((query) => {
    const bool = query.body?.query?.bool;
    if (bool != null && Array.isArray(bool.filter)) {
      bool.filter.push({ term: { viewer: 'filter' } });
    }
  });
  return delegator;
};

const gate = (
  delegator: ReturnType<typeof makeDelegator>,
  search: PageIndexSearchFn,
  findSnippetVisiblePageIds: FindSnippetVisiblePageIdsFn = mongoAllowsAll,
) => createSearchAccessiblePages(delegator, search, findSnippetVisiblePageIds);

describe('createSearchAccessiblePages', () => {
  it('applies the shared page-search viewer filter and restricts to the requested ids', async () => {
    const delegator = makeDelegator();
    const search = vi.fn<PageIndexSearchFn>().mockResolvedValue(response([]));
    const userGroups = [groupId];

    await gate(delegator, search)(
      ['p1', 'p2', 'p1'],
      {
        user: owner,
        userGroups,
      },
      NO_FILTER,
    );

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

    await gate(delegator, search)(
      ['p1'],
      {
        user: null,
        userGroups: null,
      },
      NO_FILTER,
    );

    expect(delegator.filterPagesByViewer).toHaveBeenCalledWith(
      expect.anything(),
      null,
      null,
    );
  });

  it('does not query when no ids are given', async () => {
    const search = vi.fn<PageIndexSearchFn>();

    const result = await gate(makeDelegator(), search)(
      [],
      { user: null, userGroups: null },
      NO_FILTER,
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

    const result = await gate(makeDelegator(), search)(
      ['public', 'mine', 'others', 'my-group', 'other-group', 'link-only'],
      { user: owner, userGroups: [groupId] },
      NO_FILTER,
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

    const result = await gate(makeDelegator(), search)(
      ['p1', 'missing'],
      { user: null, userGroups: null },
      NO_FILTER,
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
      gate(makeDelegator(), search)(
        ['p1'],
        {
          user: null,
          userGroups: null,
        },
        NO_FILTER,
      ),
    ).rejects.toThrow(/shard/);
  });

  it('rejects a timed-out response', async () => {
    const search = vi
      .fn<PageIndexSearchFn>()
      .mockResolvedValue(
        response([hit('p1', PageGrant.GRANT_PUBLIC)], { timed_out: true }),
      );

    await expect(
      gate(makeDelegator(), search)(
        ['p1'],
        {
          user: null,
          userGroups: null,
        },
        NO_FILTER,
      ),
    ).rejects.toThrow(/timed out/);
  });

  it('propagates a search failure', async () => {
    const search = vi
      .fn<PageIndexSearchFn>()
      .mockRejectedValue(new Error('connection refused'));

    await expect(
      gate(makeDelegator(), search)(
        ['p1'],
        {
          user: null,
          userGroups: null,
        },
        NO_FILTER,
      ),
    ).rejects.toThrow('connection refused');
  });

  it('narrows with the query operators through the page-search builders, never with keyword terms', async () => {
    const delegator = makeDelegator();
    const search = vi.fn<PageIndexSearchFn>().mockResolvedValue(response([]));
    const filter: PageSearchFilter = {
      terms: { ...NO_FILTER.terms, prefix: ['/team/'], not_prefix: ['/user'] },
      resolvedFilterData: { groupIds: ['g1'], notGroupIds: [] },
    };

    await gate(delegator, search)(
      ['p1'],
      { user: owner, userGroups: [groupId] },
      filter,
    );

    const appliedTerms =
      delegator.appendCriteriaForQueryString.mock.calls[0][1];
    expect(appliedTerms).toMatchObject({
      match: [],
      not_match: [],
      phrase: [],
      not_phrase: [],
      prefix: ['/team/'],
      not_prefix: ['/user'],
    });
    expect(delegator.appendCriteriaForGroupFilter).toHaveBeenCalledWith(
      expect.anything(),
      appliedTerms,
      filter.resolvedFilterData,
    );
    const sent = JSON.stringify(search.mock.calls[0][0].query);
    expect(sent).toContain('"operators":"/team/"');
    expect(sent).toContain('"not_prefix":"/user"');
    expect(sent).toContain('"viewer":"filter"');
  });

  describe('MongoDB check', () => {
    it('drops a page the page index allows but whose MongoDB document does not', async () => {
      const search = vi
        .fn<PageIndexSearchFn>()
        .mockResolvedValue(
          response([
            hit('fresh', PageGrant.GRANT_PUBLIC),
            hit('stale', PageGrant.GRANT_PUBLIC),
          ]),
        );
      const findInMongo = vi
        .fn<FindSnippetVisiblePageIdsFn>()
        .mockResolvedValue(new Set(['fresh']));

      const result = await gate(makeDelegator(), search, findInMongo)(
        ['fresh', 'stale'],
        { user: owner, userGroups: [groupId] },
        NO_FILTER,
      );

      expect(result.map((p) => p.pageId)).toEqual(['fresh']);
      expect(findInMongo).toHaveBeenCalledWith(['fresh', 'stale'], {
        user: owner,
        userGroups: [groupId],
      });
    });

    it('asks MongoDB only about pages the page index allowed', async () => {
      const search = vi
        .fn<PageIndexSearchFn>()
        .mockResolvedValue(
          response([
            hit('public', PageGrant.GRANT_PUBLIC),
            hit('link-only', PageGrant.GRANT_RESTRICTED),
          ]),
        );
      const findInMongo = vi.fn<FindSnippetVisiblePageIdsFn>(mongoAllowsAll);

      await gate(makeDelegator(), search, findInMongo)(
        ['public', 'link-only', '*'],
        { user: null, userGroups: null },
        NO_FILTER,
      );

      expect(findInMongo).toHaveBeenCalledWith(['public'], {
        user: null,
        userGroups: null,
      });
    });

    it('rejects when the MongoDB lookup fails', async () => {
      const search = vi
        .fn<PageIndexSearchFn>()
        .mockResolvedValue(response([hit('p1', PageGrant.GRANT_PUBLIC)]));
      const findInMongo = vi
        .fn<FindSnippetVisiblePageIdsFn>()
        .mockRejectedValue(new Error('mongo down'));

      await expect(
        gate(makeDelegator(), search, findInMongo)(
          ['p1'],
          { user: null, userGroups: null },
          NO_FILTER,
        ),
      ).rejects.toThrow('mongo down');
    });
  });
});
