import type { estypes } from '@elastic/elasticsearch8';
import mongoose from 'mongoose';
import type { Namespace } from 'socket.io';
import {
  type DeepMockProxy,
  type MockProxy,
  mock,
  mockDeep,
} from 'vitest-mock-extended';

import { AuditlogEsSyncStatus } from '~/features/auditlog-es-sync/server';
import { SocketEventName } from '~/interfaces/websocket';
import type { ESQueryTerms } from '~/server/interfaces/search';
import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager/config-manager';
import type { SocketIoService } from '~/server/service/socket-io';

import ElasticsearchDelegator from './elasticsearch';
import { injectClient } from './elasticsearch.testing';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';
import type { ES8ClientDelegator } from './elasticsearch-client-delegator/es8-client-delegator';

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/features/auditlog-es-sync/server', () => ({
  AuditlogEsSyncStatus: { setUnsynced: vi.fn() },
}));

export const createMockESQueryTerms = (
  overrides: Partial<ESQueryTerms> = {},
): ESQueryTerms => {
  return {
    match: [],
    not_match: [],
    phrase: [],
    not_phrase: [],
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
    ...overrides,
  };
};

describe('ElasticsearchDelegator', () => {
  let delegator: ElasticsearchDelegator;
  let mockSocketIo: MockProxy<SocketIoService>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.getConfig).mockImplementation((key) => {
      if (key === 'app:elasticsearchVersion') return 8;
      return false;
    });

    mockSocketIo = mock<SocketIoService>();
    delegator = new ElasticsearchDelegator(mockSocketIo);
  });

  describe('appendCriteriaForQueryString()', () => {
    it('adds no filter clause when no author/editor terms are present', () => {
      const terms = createMockESQueryTerms();
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toEqual([]);
    });

    it('filters by author via a should (OR) clause', () => {
      const terms = createMockESQueryTerms({ author: ['dennis'] });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: { should: [{ term: { username: 'dennis' } }] },
      });
    });

    it('excludes the author via a must_not clause', () => {
      const terms = createMockESQueryTerms({ not_author: ['dennis'] });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: { must_not: [{ term: { username: 'dennis' } }] },
      });
    });

    it('filters by editor via a should (OR) clause', () => {
      const terms = createMockESQueryTerms({ editor: ['dennis'] });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: { should: [{ term: { last_update_username: 'dennis' } }] },
      });
    });

    it('excludes the editor via a must_not clause', () => {
      const terms = createMockESQueryTerms({ not_editor: ['alice'] });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: { must_not: [{ term: { last_update_username: 'alice' } }] },
      });
    });

    it('combines author and editor as separate AND-ed filter clauses', () => {
      const terms = createMockESQueryTerms({
        editor: ['dennis'],
        author: ['alice'],
      });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: { should: [{ term: { last_update_username: 'dennis' } }] },
      });
      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: { should: [{ term: { username: 'alice' } }] },
      });
    });

    it('combines two authors into a single OR (should) clause', () => {
      const terms = createMockESQueryTerms({ author: ['dennis', 'alice'] });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: {
          should: [
            { term: { username: 'dennis' } },
            { term: { username: 'alice' } },
          ],
        },
      });
    });

    it('combines two editors into a single OR (should) clause', () => {
      const terms = createMockESQueryTerms({ editor: ['dennis', 'alice'] });
      const query = delegator.createSearchQuery();

      delegator.appendCriteriaForQueryString(query, terms);

      expect(query.body?.query.bool?.filter).toContainEqual({
        bool: {
          should: [
            { term: { last_update_username: 'dennis' } },
            { term: { last_update_username: 'alice' } },
          ],
        },
      });
    });
  });

  describe('appendCriteriaForGroupFilter()', () => {
    it('filters by group via a terms filter clause', () => {
      const terms = createMockESQueryTerms({ group: ['dev-1'] });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: ['id1'],
        notGroupIds: [],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.filter).toContainEqual({
        terms: { granted_groups: ['id1'] },
      });
    });

    it('excludes the group via a must_not clause', () => {
      const terms = createMockESQueryTerms({ not_group: ['dev-1'] });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: [],
        notGroupIds: ['id1'],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.must_not).toContainEqual({
        terms: { granted_groups: ['id1'] },
      });
    });

    it('combines two groups into a single terms filter clause', () => {
      const terms = createMockESQueryTerms({ group: ['dev-1', 'dev-2'] });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: ['id1', 'id2'],
        notGroupIds: [],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.filter).toContainEqual({
        terms: { granted_groups: ['id1', 'id2'] },
      });
    });

    it('applies group as a filter clause and not-group as a must_not clause', () => {
      const terms = createMockESQueryTerms({
        group: ['dev-1'],
        not_group: ['dev-2'],
      });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: ['id1'],
        notGroupIds: ['id2'],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.filter).toContainEqual({
        terms: { granted_groups: ['id1'] },
      });
      expect(query.body?.query.bool?.must_not).toContainEqual({
        terms: { granted_groups: ['id2'] },
      });
    });

    it('keeps the positive group clause even when no group ids resolve (matching nothing)', () => {
      const terms = createMockESQueryTerms({ group: ['nonexistent'] });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: [],
        notGroupIds: [],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.filter).toContainEqual({
        terms: { granted_groups: [] },
      });
    });

    it('does nothing when resolvedFilterData is undefined', () => {
      const terms = createMockESQueryTerms({ group: ['dev-1'] });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = undefined;

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.filter).toBeUndefined();
      expect(query.body?.query.bool?.must_not).toBeUndefined();
    });

    it('keeps the negative group clause even when no not-group ids resolve (excluding nothing)', () => {
      const terms = createMockESQueryTerms({ not_group: ['nonexistent'] });
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: [],
        notGroupIds: [],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.must_not).toContainEqual({
        terms: { granted_groups: [] },
      });
    });

    it('pushes no group clause when no group terms are present', () => {
      const terms = createMockESQueryTerms();
      const query = delegator.createSearchQuery();

      const resolvedFilterData = {
        groupIds: [],
        notGroupIds: [],
      };

      delegator.appendCriteriaForGroupFilter(query, terms, resolvedFilterData);

      expect(query.body?.query.bool?.filter).toEqual([]);
      expect(query.body?.query.bool?.must_not).toEqual([]);
    });
  });

  // Contract of dropping Elasticsearch 7 support: the delegator must be
  // constructable only for the supported versions (8, 9) and must reject any
  // other value of ELASTICSEARCH_VERSION with a clear error instead of silently
  // falling back.
  describe('ElasticsearchDelegator constructor — supported version gate', () => {
    // Use the same module-mocked configManager the rest of the file relies on
    // (a vi.spyOn + restoreAllMocks strategy here would clobber that module mock
    // and break the shared beforeEach for later tests).
    const stubElasticsearchVersion = (version: number | undefined) => {
      vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
        if (key === 'app:elasticsearchVersion') return version;
        if (key === 'app:elasticsearchReindexOnBoot') return false;
        return undefined;
      });
    };

    it.each([8, 9])('accepts supported version %i', (version) => {
      stubElasticsearchVersion(version);
      expect(() => new ElasticsearchDelegator(mockSocketIo)).not.toThrow();
    });

    it('rejects Elasticsearch 7 (support removed)', () => {
      stubElasticsearchVersion(7);
      expect(() => new ElasticsearchDelegator(mockSocketIo)).toThrow(
        'Unsupported Elasticsearch version',
      );
    });

    it.each([
      6,
      10,
      undefined,
    ])('rejects unsupported/invalid version %s', (version) => {
      stubElasticsearchVersion(version);
      expect(() => new ElasticsearchDelegator(mockSocketIo)).toThrow(
        'Unsupported Elasticsearch version',
      );
    });
  });

  describe('searchAuditlogByFuzzyWildcard()', () => {
    const makeBuckets = (keys: string[]) =>
      keys.map((key) => ({ key, doc_count: 1 }));

    describe('ES8/9 path', () => {
      let mockES8Client: MockProxy<ES8ClientDelegator>;

      beforeEach(() => {
        mockES8Client = mock<ES8ClientDelegator>({ delegatorVersion: 8 });
        mockES8Client.search.mockResolvedValue(
          mock<estypes.SearchResponse>({
            aggregations: {
              unique_values: { buckets: makeBuckets(['alice', 'bob']) },
            },
          }),
        );
        injectClient(delegator, mockES8Client);
      });

      it('should escape *, ?, \\ in query', async () => {
        await delegator.searchAuditlogByFuzzyWildcard(
          'username',
          'a*b?c\\d',
          10,
        );

        expect(mockES8Client.search).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                should: expect.arrayContaining([
                  expect.objectContaining({
                    wildcard: expect.objectContaining({
                      username: expect.objectContaining({
                        value: 'a\\*b\\?c\\\\d*',
                        case_insensitive: true,
                      }),
                    }),
                  }),
                  expect.objectContaining({
                    fuzzy: expect.objectContaining({
                      username: expect.objectContaining({
                        value: 'a\\*b\\?c\\\\d',
                        fuzziness: 'AUTO',
                      }),
                    }),
                  }),
                ]),
              }),
            }),
          }),
        );
      });

      it('should use auditlogs-alias as index', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 10);

        expect(mockES8Client.search).toHaveBeenCalledWith(
          expect.objectContaining({ index: 'auditlogs-alias' }),
        );
      });

      it('should use flat format without body wrapper', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 10);

        expect(mockES8Client.search).toHaveBeenCalledWith(
          expect.objectContaining({ size: 0 }),
        );
        expect(mockES8Client.search).not.toHaveBeenCalledWith(
          expect.objectContaining({ body: expect.anything() }),
        );
      });

      it('should pass limit to terms.size', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 5);

        expect(mockES8Client.search).toHaveBeenCalledWith(
          expect.objectContaining({
            aggs: expect.objectContaining({
              unique_values: expect.objectContaining({
                terms: expect.objectContaining({ size: 5 }),
              }),
            }),
          }),
        );
      });

      it('should return bucket keys as string array', async () => {
        const result = await delegator.searchAuditlogByFuzzyWildcard(
          'username',
          'alice',
          10,
        );

        expect(result).toEqual(['alice', 'bob']);
      });

      it('should return [] when rawBuckets is not an array', async () => {
        mockES8Client.search.mockResolvedValue(
          mock<estypes.SearchResponse>({
            aggregations: { unique_values: { buckets: 'invalid' } },
          }),
        );

        const result = await delegator.searchAuditlogByFuzzyWildcard(
          'username',
          'alice',
          10,
        );

        expect(result).toEqual([]);
      });
    });

    describe('unknown client type', () => {
      beforeEach(() => {
        injectClient(delegator, {
          delegatorVersion: 0,
        } as unknown as ElasticsearchClientDelegator);
      });

      it('should return []', async () => {
        const result = await delegator.searchAuditlogByFuzzyWildcard(
          'username',
          'alice',
          10,
        );

        expect(result).toEqual([]);
      });
    });
  });

  describe('normalizeAuditlogIndices()', () => {
    let mockES8Client: DeepMockProxy<ES8ClientDelegator>;

    // Resolve existence per index name so assertions don't depend on probe order.
    const givenIndexState = (state: {
      tmpExists: boolean;
      indexExists: boolean;
      aliasExists: boolean;
    }) => {
      mockES8Client.indices.exists.mockImplementation((params) =>
        Promise.resolve(
          params.index === 'auditlogs-tmp'
            ? state.tmpExists
            : state.indexExists,
        ),
      );
      mockES8Client.indices.existsAlias.mockResolvedValue(state.aliasExists);
    };

    beforeEach(() => {
      mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
      injectClient(delegator, mockES8Client);
    });

    it('deletes the leftover tmp index when it exists', async () => {
      givenIndexState({
        tmpExists: true,
        indexExists: true,
        aliasExists: true,
      });

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.delete).toHaveBeenCalledWith({
        index: 'auditlogs-tmp',
      });
    });

    it('leaves the tmp index alone when it does not exist', async () => {
      givenIndexState({
        tmpExists: false,
        indexExists: true,
        aliasExists: true,
      });

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.delete).not.toHaveBeenCalled();
    });

    it('creates the main index when it is missing', async () => {
      givenIndexState({
        tmpExists: false,
        indexExists: false,
        aliasExists: true,
      });

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'auditlogs' }),
      );
    });

    it('does not create the main index when it already exists', async () => {
      givenIndexState({
        tmpExists: false,
        indexExists: true,
        aliasExists: true,
      });

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.create).not.toHaveBeenCalled();
    });

    it('adds the alias when it is missing', async () => {
      givenIndexState({
        tmpExists: false,
        indexExists: true,
        aliasExists: false,
      });

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.putAlias).toHaveBeenCalledWith({
        name: 'auditlogs-alias',
        index: 'auditlogs',
      });
    });

    it('does not touch the alias when it already exists', async () => {
      givenIndexState({
        tmpExists: false,
        indexExists: true,
        aliasExists: true,
      });

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.putAlias).not.toHaveBeenCalled();
    });
  });

  describe('rebuildAuditlogIndex()', () => {
    let mockES8Client: DeepMockProxy<ES8ClientDelegator>;
    let addAllAuditlogsSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
      injectClient(delegator, mockES8Client);
      // Explicit defaults so tests don't rely on mockDeep returning undefined for unstubbed async calls.
      mockES8Client.indices.exists.mockResolvedValue(false);
      mockES8Client.indices.existsAlias.mockResolvedValue(false);
      // addAllAuditlogs streams from MongoDB, so it cannot run in a unit test — stub it.
      // normalizeAuditlogIndices runs for real (the ES client is mocked) so the resulting
      // index state stays observable rather than being asserted through a spy.
      addAllAuditlogsSpy = vi
        .spyOn(delegator, 'addAllAuditlogs')
        .mockResolvedValue({ totalCount: 0, count: 0 });
    });

    it('reindexes into the tmp index before dropping the live index', async () => {
      await delegator.rebuildAuditlogIndex();

      // The reindex must be issued before the live index is dropped. Ordering only:
      // reindex is fire-and-forget, so tmp is best-effort; the source of truth on
      // repopulation is addAllAuditlogs (MongoDB), not this copy.
      expect(mockES8Client.reindex.mock.invocationCallOrder[0]).toBeLessThan(
        mockES8Client.indices.delete.mock.invocationCallOrder[0],
      );
    });

    it('recreates and repopulates the live index', async () => {
      await delegator.rebuildAuditlogIndex();

      expect(mockES8Client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'auditlogs' }),
      );
      expect(addAllAuditlogsSpy).toHaveBeenCalledWith({
        shouldEmitProgress: false,
      });
    });

    it('swaps the alias onto the tmp index while the live index is rebuilt', async () => {
      await delegator.rebuildAuditlogIndex();

      // Must happen before the live index is dropped, or the alias would dangle.
      expect(mockES8Client.indices.updateAliases).toHaveBeenNthCalledWith(1, {
        actions: [
          { add: { alias: 'auditlogs-alias', index: 'auditlogs-tmp' } },
          { remove: { alias: 'auditlogs-alias', index: 'auditlogs' } },
        ],
      });
      expect(
        mockES8Client.indices.updateAliases.mock.invocationCallOrder[0],
      ).toBeLessThan(mockES8Client.indices.delete.mock.invocationCallOrder[0]);
    });

    it('restores the alias onto the live index after a successful rebuild', async () => {
      await delegator.rebuildAuditlogIndex();

      // The mid-rebuild swap leaves the alias on tmp; the rebuild must atomically swap
      // it back onto the live index so the alias never resolves to nothing —
      // and only after the live index has been repopulated.
      expect(mockES8Client.indices.updateAliases).toHaveBeenNthCalledWith(2, {
        actions: [
          { add: { alias: 'auditlogs-alias', index: 'auditlogs' } },
          { remove: { alias: 'auditlogs-alias', index: 'auditlogs-tmp' } },
        ],
      });
      expect(
        mockES8Client.indices.updateAliases.mock.invocationCallOrder[1],
      ).toBeGreaterThan(addAllAuditlogsSpy.mock.invocationCallOrder[0]);
    });

    it('deletes a leftover tmp index before reindexing', async () => {
      mockES8Client.indices.exists.mockResolvedValue(true);

      await delegator.rebuildAuditlogIndex();

      expect(mockES8Client.indices.delete).toHaveBeenCalledWith({
        index: 'auditlogs-tmp',
      });
      expect(
        mockES8Client.indices.delete.mock.invocationCallOrder[0],
      ).toBeLessThan(mockES8Client.reindex.mock.invocationCallOrder[0]);
    });

    it('does not delete a tmp index when none is leftover', async () => {
      mockES8Client.indices.exists.mockResolvedValue(false);

      await delegator.rebuildAuditlogIndex();

      expect(mockES8Client.indices.delete).not.toHaveBeenCalledWith({
        index: 'auditlogs-tmp',
      });
    });

    it('restores the indices and rethrows when a rebuild step fails', async () => {
      mockES8Client.reindex.mockRejectedValue(new Error('reindex failed'));

      await expect(delegator.rebuildAuditlogIndex()).rejects.toThrow(
        'reindex failed',
      );
      // Recovery still runs in `finally`: the alias is restored onto the live index.
      expect(mockES8Client.indices.putAlias).toHaveBeenCalledWith({
        name: 'auditlogs-alias',
        index: 'auditlogs',
      });
    });

    it('rethrows the original rebuild error even when normalization fails', async () => {
      mockES8Client.reindex.mockRejectedValue(new Error('reindex failed'));
      // putAlias is only reached from normalizeAuditlogIndices (the finally), not the
      // try block, so failing it isolates a normalization failure during recovery.
      mockES8Client.indices.putAlias.mockRejectedValue(
        new Error('normalize failed'),
      );

      await expect(delegator.rebuildAuditlogIndex()).rejects.toThrow(
        'reindex failed',
      );
    });

    describe('with shouldEmitProgress: true', () => {
      let mockAdminSocket: MockProxy<Namespace>;

      beforeEach(() => {
        mockAdminSocket = mock<Namespace>();
        mockSocketIo.getAdminSocket.mockReturnValue(mockAdminSocket);
        vi.mocked(AuditlogEsSyncStatus.setUnsynced).mockResolvedValue();
      });

      it('clears the unsynced flag and emits FinishAddAuditlog on success', async () => {
        addAllAuditlogsSpy.mockResolvedValue({ totalCount: 100, count: 100 });

        const result = await delegator.rebuildAuditlogIndex({
          shouldEmitProgress: true,
        });

        expect(result).toEqual({ totalCount: 100, count: 100 });
        expect(AuditlogEsSyncStatus.setUnsynced).toHaveBeenCalledWith(false);
        expect(mockAdminSocket.emit).toHaveBeenCalledWith(
          SocketEventName.FinishAddAuditlog,
          { totalCount: 100, count: 100 },
        );
      });

      it('still emits FinishAddAuditlog when clearing the unsynced flag fails', async () => {
        addAllAuditlogsSpy.mockResolvedValue({ totalCount: 100, count: 100 });
        vi.mocked(AuditlogEsSyncStatus.setUnsynced).mockRejectedValue(
          new Error('db unavailable'),
        );

        const result = await delegator.rebuildAuditlogIndex({
          shouldEmitProgress: true,
        });

        // The ES rebuild itself succeeded, so the client should not be left stuck
        // in a processing state just because the unrelated flag write failed.
        expect(result).toEqual({ totalCount: 100, count: 100 });
        expect(mockAdminSocket.emit).toHaveBeenCalledWith(
          SocketEventName.FinishAddAuditlog,
          { totalCount: 100, count: 100 },
        );
      });

      it('emits AuditlogRebuildingFailed and not FinishAddAuditlog on failure', async () => {
        mockES8Client.reindex.mockRejectedValue(new Error('reindex failed'));

        await expect(
          delegator.rebuildAuditlogIndex({ shouldEmitProgress: true }),
        ).rejects.toThrow('reindex failed');

        expect(mockAdminSocket.emit).toHaveBeenCalledWith(
          SocketEventName.AuditlogRebuildingFailed,
          { error: 'reindex failed' },
        );
        expect(mockAdminSocket.emit).not.toHaveBeenCalledWith(
          SocketEventName.FinishAddAuditlog,
          expect.anything(),
        );
        expect(AuditlogEsSyncStatus.setUnsynced).not.toHaveBeenCalled();
      });
    });
  });

  describe('rebuildIndex()', () => {
    let mockES8Client: DeepMockProxy<ES8ClientDelegator>;
    let addAllPagesSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
      injectClient(delegator, mockES8Client);
      mockES8Client.indices.exists.mockResolvedValue(false);
      // addAllPages streams from MongoDB, so it cannot run in a unit test — stub it.
      addAllPagesSpy = vi
        .spyOn(delegator, 'addAllPages')
        .mockResolvedValue({ totalCount: 0, count: 0 });
    });

    describe('with shouldEmitProgress: true', () => {
      let mockAdminSocket: MockProxy<Namespace>;

      beforeEach(() => {
        mockAdminSocket = mock<Namespace>();
        mockSocketIo.getAdminSocket.mockReturnValue(mockAdminSocket);
      });

      it('emits FinishAddPage only after normalizeIndices has completed', async () => {
        addAllPagesSpy.mockResolvedValue({ totalCount: 10, count: 10 });
        const normalizeSpy = vi.spyOn(delegator, 'normalizeIndices');

        await delegator.rebuildIndex({ shouldEmitProgress: true });

        expect(mockAdminSocket.emit).toHaveBeenCalledOnce();
        expect(mockAdminSocket.emit).toHaveBeenCalledWith(
          SocketEventName.FinishAddPage,
          { totalCount: 10, count: 10 },
        );
        // Regression guard: previously FinishAddPage fired from within addAllPages,
        // racing the client's post-finish isNormalized poll against normalizeIndices.
        expect(normalizeSpy.mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(mockAdminSocket.emit).mock.invocationCallOrder[0],
        );
      });

      it('still emits FinishAddPage when normalizeIndices fails after a successful rebuild', async () => {
        addAllPagesSpy.mockResolvedValue({ totalCount: 10, count: 10 });
        vi.spyOn(delegator, 'normalizeIndices').mockRejectedValue(
          new Error('normalize failed'),
        );

        // Regression guard: previously an unswallowed normalize failure in the
        // `finally` block masked a successful rebuild, rejecting rebuildIndex
        // and leaving the client stuck (no FinishAddPage, no RebuildingFailed).
        await expect(
          delegator.rebuildIndex({ shouldEmitProgress: true }),
        ).resolves.toBeUndefined();

        expect(mockAdminSocket.emit).toHaveBeenCalledWith(
          SocketEventName.FinishAddPage,
          { totalCount: 10, count: 10 },
        );
      });

      it('does not emit FinishAddPage when the rebuild fails', async () => {
        mockES8Client.reindex.mockRejectedValue(new Error('reindex failed'));

        await expect(
          delegator.rebuildIndex({ shouldEmitProgress: true }),
        ).rejects.toThrow('reindex failed');

        expect(mockAdminSocket.emit).toHaveBeenCalledWith(
          SocketEventName.RebuildingFailed,
          { error: 'reindex failed' },
        );
        expect(mockAdminSocket.emit).not.toHaveBeenCalledWith(
          SocketEventName.FinishAddPage,
          expect.anything(),
        );
      });
    });

    it('does not emit any socket event when shouldEmitProgress is false', async () => {
      const mockAdminSocket = mock<Namespace>();
      mockSocketIo.getAdminSocket.mockReturnValue(mockAdminSocket);

      await delegator.rebuildIndex({ shouldEmitProgress: false });

      expect(mockAdminSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('getAuditlogInfoForAdmin()', () => {
    let mockES8Client: DeepMockProxy<ES8ClientDelegator>;

    const givenIndexAndAliasState = (state: {
      mainExists: boolean;
      tmpExists: boolean;
      mainHasAlias: boolean;
      tmpHasAlias?: boolean;
    }) => {
      mockES8Client.indices.exists.mockImplementation((params) =>
        Promise.resolve(
          params.index === 'auditlogs-tmp' ? state.tmpExists : state.mainExists,
        ),
      );

      const aliasEntry = (
        hasAlias: boolean,
      ): estypes.IndicesGetAliasIndexAliases =>
        hasAlias ? { aliases: { 'auditlogs-alias': {} } } : { aliases: {} };

      const aliasResponse: estypes.IndicesGetAliasResponse = {};
      if (state.mainExists)
        aliasResponse.auditlogs = aliasEntry(state.mainHasAlias);
      if (state.tmpExists)
        aliasResponse['auditlogs-tmp'] = aliasEntry(state.tmpHasAlias ?? false);

      mockES8Client.indices.getAlias.mockResolvedValue(aliasResponse);
      mockES8Client.indices.stats.mockResolvedValue(
        mock<estypes.IndicesStatsResponse>({ indices: {} }),
      );
    };

    beforeEach(() => {
      mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
      injectClient(delegator, mockES8Client);
    });

    it('returns isNormalized: true when only the main index exists with the alias', async () => {
      givenIndexAndAliasState({
        mainExists: true,
        tmpExists: false,
        mainHasAlias: true,
      });

      const result = await delegator.getAuditlogInfoForAdmin();

      expect(result.isNormalized).toBe(true);
    });

    it('returns isNormalized: false when the main index exists but has no alias', async () => {
      givenIndexAndAliasState({
        mainExists: true,
        tmpExists: false,
        mainHasAlias: false,
      });

      const result = await delegator.getAuditlogInfoForAdmin();

      expect(result.isNormalized).toBe(false);
    });

    it('returns isNormalized: false when both main and tmp indices exist (mid-rebuild state)', async () => {
      givenIndexAndAliasState({
        mainExists: true,
        tmpExists: true,
        mainHasAlias: true,
      });

      const result = await delegator.getAuditlogInfoForAdmin();

      expect(result.isNormalized).toBe(false);
    });

    it('returns empty indices and aliases with isNormalized: false when no index exists', async () => {
      givenIndexAndAliasState({
        mainExists: false,
        tmpExists: false,
        mainHasAlias: false,
      });

      const result = await delegator.getAuditlogInfoForAdmin();

      expect(result).toEqual({ indices: [], aliases: [], isNormalized: false });
    });

    it('returns isNormalized: false without throwing when the index disappears between exists and getAlias (TOCTOU)', async () => {
      mockES8Client.indices.exists.mockResolvedValue(true);
      mockES8Client.indices.getAlias.mockResolvedValue({});
      mockES8Client.indices.stats.mockResolvedValue(
        mock<estypes.IndicesStatsResponse>({ indices: {} }),
      );

      await expect(delegator.getAuditlogInfoForAdmin()).resolves.toMatchObject({
        isNormalized: false,
      });
    });
  });

  describe('bulkSyncAuditlogs()', () => {
    let mockES8Client: MockProxy<ES8ClientDelegator>;

    const makeActivity = (username?: string) =>
      mock<ActivityDocument>({
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username },
      });

    beforeEach(() => {
      mockES8Client = mock<ES8ClientDelegator>({ delegatorVersion: 8 });
      mockES8Client.bulk.mockResolvedValue(
        mock<Awaited<ReturnType<typeof mockES8Client.bulk>>>({
          errors: false,
          items: [],
        }),
      );
      injectClient(delegator, mockES8Client);
    });

    it('indexes upserts into the concrete index, not the alias', async () => {
      const activity = makeActivity('alice');

      await delegator.bulkSyncAuditlogs([activity], []);

      expect(mockES8Client.bulk).toHaveBeenCalledWith({
        body: [
          { index: { _index: 'auditlogs', _id: activity._id.toString() } },
          { username: 'alice' },
        ],
      });
    });

    it('deletes by id from the concrete index, not the alias', async () => {
      const id = new mongoose.Types.ObjectId();

      await delegator.bulkSyncAuditlogs([], [id]);

      expect(mockES8Client.bulk).toHaveBeenCalledWith({
        body: [{ delete: { _index: 'auditlogs', _id: id.toString() } }],
      });
    });

    it('skips upserts that have no username', async () => {
      await delegator.bulkSyncAuditlogs([makeActivity()], []);

      expect(mockES8Client.bulk).not.toHaveBeenCalled();
    });

    it('does not call bulk when there is nothing to sync', async () => {
      await delegator.bulkSyncAuditlogs([], []);

      expect(mockES8Client.bulk).not.toHaveBeenCalled();
    });

    it('throws with the failed item count when the response reports per-item errors', async () => {
      mockES8Client.bulk.mockResolvedValue({
        took: 0,
        errors: true,
        items: [
          {
            index: {
              _index: 'auditlogs',
              status: 400,
              error: { type: 'mapper_exception' },
            },
          },
        ],
      });

      await expect(
        delegator.bulkSyncAuditlogs([makeActivity('alice')], []),
      ).rejects.toThrow('1 failed items');
    });

    it('throws a debuggable message when the errors flag is set without a matching item error', async () => {
      mockES8Client.bulk.mockResolvedValue({
        took: 0,
        errors: true,
        items: [
          { index: { _index: 'auditlogs', status: 200, result: 'created' } },
        ],
      });

      await expect(
        delegator.bulkSyncAuditlogs([makeActivity('alice')], []),
      ).rejects.toThrow('errors flag set but no per-item error');
    });
  });
});
