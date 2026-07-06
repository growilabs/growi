import type { estypes as estypes7 } from '@elastic/elasticsearch7';
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
import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager/config-manager';
import type { SocketIoService } from '~/server/service/socket-io';

import ElasticsearchDelegator from './elasticsearch';
import { injectClient } from './elasticsearch.testing';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';
import type { ES7ClientDelegator } from './elasticsearch-client-delegator/es7-client-delegator';
import type { ES8ClientDelegator } from './elasticsearch-client-delegator/es8-client-delegator';

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/features/auditlog-es-sync/server', () => ({
  AuditlogEsSyncStatus: { setUnsynced: vi.fn() },
}));

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

    describe('ES7 path', () => {
      let mockES7Client: MockProxy<ES7ClientDelegator>;

      beforeEach(() => {
        mockES7Client = mock<ES7ClientDelegator>({ delegatorVersion: 7 });
        mockES7Client.search.mockResolvedValue(
          mock<estypes7.SearchResponse>({
            aggregations: {
              unique_values: { buckets: makeBuckets(['alice']) },
            },
          }),
        );
        injectClient(delegator, mockES7Client);
      });

      it('should use auditlogs-alias as index', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 10);

        expect(mockES7Client.search).toHaveBeenCalledWith(
          expect.objectContaining({ index: 'auditlogs-alias' }),
        );
      });

      it('should use body wrapper format', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 10);

        expect(mockES7Client.search).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              size: 0,
              aggs: expect.objectContaining({
                unique_values: expect.objectContaining({
                  terms: expect.objectContaining({ field: 'username' }),
                }),
              }),
            }),
          }),
        );
      });

      it('should pass limit to terms.size', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 5);

        expect(mockES7Client.search).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              aggs: expect.objectContaining({
                unique_values: expect.objectContaining({
                  terms: expect.objectContaining({ size: 5 }),
                }),
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

        expect(result).toEqual(['alice']);
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

      // The alias must move onto tmp before the live index is dropped so it stays attached
      // to an existing index rather than dangling. (tmp may be incomplete; reindex is
      // best-effort — see the addAllAuditlogs repopulation below.)
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
