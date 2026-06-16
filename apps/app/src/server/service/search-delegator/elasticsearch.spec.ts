import mongoose from 'mongoose';
import { vi } from 'vitest';
import {
  type DeepMockProxy,
  type MockProxy,
  mock,
  mockDeep,
} from 'vitest-mock-extended';

import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import type { SocketIoService } from '~/server/service/socket-io';

import ElasticsearchDelegator from './elasticsearch';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';
import type { ES7ClientDelegator } from './elasticsearch-client-delegator/es7-client-delegator';
import type { ES8ClientDelegator } from './elasticsearch-client-delegator/es8-client-delegator';

const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }));

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockError,
  })),
}));

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

// type-assertion (unavoidable): no public seam to set the version-specific client.
const injectClient = (
  target: ElasticsearchDelegator,
  client: ElasticsearchClientDelegator,
) => {
  (target as unknown as { client: ElasticsearchClientDelegator }).client =
    client;
};

describe('ElasticsearchDelegator', () => {
  let delegator: ElasticsearchDelegator;
  let mockSocketIo: MockProxy<SocketIoService>;
  let mockES8Client: DeepMockProxy<ES8ClientDelegator>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.getConfig).mockImplementation((key) => {
      if (key === 'app:elasticsearchVersion') return 8;
      return false;
    });

    mockSocketIo = mock<SocketIoService>();
    delegator = new ElasticsearchDelegator(mockSocketIo);

    mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
    mockES8Client.bulk.mockResolvedValue({
      errors: false,
      items: [],
    } as unknown as Awaited<ReturnType<typeof mockES8Client.bulk>>);
    (delegator as unknown as { client: ElasticsearchClientDelegator }).client =
      mockES8Client;
  });

  describe('updateOrInsertAuditlog()', () => {
    it('should not call bulk when activity is null', async () => {
      await delegator.updateOrInsertAuditlog(null);

      expect(mockES8Client.bulk).not.toHaveBeenCalled();
    });

    it('should not call bulk when snapshot.username is null', async () => {
      const activity = {
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username: null },
      } as unknown as ActivityDocument;

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockES8Client.bulk).not.toHaveBeenCalled();
    });

    it('should not call bulk when snapshot.username is empty string', async () => {
      const activity = {
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username: '' },
      } as unknown as ActivityDocument;

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockES8Client.bulk).not.toHaveBeenCalled();
    });

    it('should call bulk with correct body for valid activity', async () => {
      const id = new mongoose.Types.ObjectId();
      const activity = {
        _id: id,
        snapshot: { username: 'test-user' },
      } as unknown as ActivityDocument;

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockES8Client.bulk).toHaveBeenCalledWith({
        body: [
          { index: { _index: 'auditlogs-alias', _id: id.toString() } },
          { username: 'test-user' },
        ],
      });
    });

    it('should call logger.error when bulk response has errors', async () => {
      const activity = {
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username: 'test-user' },
      } as unknown as ActivityDocument;

      mockES8Client.bulk.mockResolvedValue({
        errors: true,
        items: [
          { index: { error: { type: 'mapper_exception', reason: 'failed' } } },
        ],
      } as unknown as Awaited<ReturnType<typeof mockES8Client.bulk>>);

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ failedItems: expect.any(Array) }),
        'updateOrInsertAuditlog bulk indexing had errors',
      );
    });

    it('should call logger.error and not throw when bulk throws', async () => {
      const activity = {
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username: 'test-user' },
      } as unknown as ActivityDocument;

      mockES8Client.bulk.mockRejectedValue(new Error('ES connection error'));

      await expect(
        delegator.updateOrInsertAuditlog(activity),
      ).resolves.toBeUndefined();
      expect(mockError).toHaveBeenCalledWith(
        'updateOrInsertAuditlog failed.',
        expect.any(Error),
      );
    });
  });

  describe('normalizeAuditlogIndices()', () => {
    let createAuditlogIndexSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
      mockES8Client.indices.delete.mockResolvedValue(
        {} as unknown as Awaited<
          ReturnType<typeof mockES8Client.indices.delete>
        >,
      );
      mockES8Client.indices.putAlias.mockResolvedValue(
        {} as unknown as Awaited<
          ReturnType<typeof mockES8Client.indices.putAlias>
        >,
      );
      (
        delegator as unknown as { client: ElasticsearchClientDelegator }
      ).client = mockES8Client;

      createAuditlogIndexSpy = vi
        .spyOn(
          delegator as unknown as {
            createAuditlogIndex: (name: string) => Promise<void>;
          },
          'createAuditlogIndex',
        )
        .mockResolvedValue(undefined);
    });

    it('should delete tmp index when it exists', async () => {
      mockES8Client.indices.exists
        .mockResolvedValueOnce(true) // auditlogs-tmp exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockES8Client.indices.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.delete).toHaveBeenCalledWith({
        index: 'auditlogs-tmp',
      });
    });

    it('should not delete tmp index when it does not exist', async () => {
      mockES8Client.indices.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockES8Client.indices.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.delete).not.toHaveBeenCalled();
    });

    it('should call createAuditlogIndex when main index does not exist', async () => {
      mockES8Client.indices.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(false); // auditlogs not exists
      mockES8Client.indices.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(createAuditlogIndexSpy).toHaveBeenCalledWith('auditlogs');
    });

    it('should not call createAuditlogIndex when main index exists', async () => {
      mockES8Client.indices.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockES8Client.indices.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(createAuditlogIndexSpy).not.toHaveBeenCalled();
    });

    it('should call putAlias when alias does not exist', async () => {
      mockES8Client.indices.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockES8Client.indices.existsAlias.mockResolvedValue(false);

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.existsAlias).toHaveBeenCalledWith({
        index: 'auditlogs',
        name: 'auditlogs-alias',
      });
      expect(mockES8Client.indices.putAlias).toHaveBeenCalledWith({
        name: 'auditlogs-alias',
        index: 'auditlogs',
      });
    });

    it('should not call putAlias when alias exists', async () => {
      mockES8Client.indices.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockES8Client.indices.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(mockES8Client.indices.putAlias).not.toHaveBeenCalled();
    });
  });

  describe('rebuildAuditlogIndex()', () => {
    let createAuditlogIndexSpy: ReturnType<typeof vi.spyOn>;
    let addAllAuditlogsSpy: ReturnType<typeof vi.spyOn>;
    let normalizeAuditlogIndicesSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
      mockES8Client.reindex.mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof mockES8Client.reindex>>,
      );
      mockES8Client.indices.delete.mockResolvedValue(
        {} as unknown as Awaited<
          ReturnType<typeof mockES8Client.indices.delete>
        >,
      );
      mockES8Client.indices.updateAliases.mockResolvedValue(
        {} as unknown as Awaited<
          ReturnType<typeof mockES8Client.indices.updateAliases>
        >,
      );
      (
        delegator as unknown as { client: ElasticsearchClientDelegator }
      ).client = mockES8Client;

      createAuditlogIndexSpy = vi
        .spyOn(
          delegator as unknown as {
            createAuditlogIndex: (name: string) => Promise<void>;
          },
          'createAuditlogIndex',
        )
        .mockResolvedValue(undefined);

      addAllAuditlogsSpy = vi
        .spyOn(delegator, 'addAllAuditlogs')
        .mockResolvedValue(undefined);

      normalizeAuditlogIndicesSpy = vi
        .spyOn(delegator, 'normalizeAuditlogIndices')
        .mockResolvedValue(undefined);
    });

    it('should execute reindex operations in the correct order', async () => {
      const callOrder: string[] = [];
      createAuditlogIndexSpy.mockImplementation((name: string) => {
        callOrder.push(`createAuditlogIndex:${name}`);
        return Promise.resolve();
      });
      mockES8Client.reindex.mockImplementation(() => {
        callOrder.push('reindex');
        return Promise.resolve(
          {} as unknown as Awaited<ReturnType<typeof mockES8Client.reindex>>,
        );
      });
      mockES8Client.indices.updateAliases.mockImplementation(() => {
        callOrder.push('updateAliases');
        return Promise.resolve(
          {} as unknown as Awaited<
            ReturnType<typeof mockES8Client.indices.updateAliases>
          >,
        );
      });
      mockES8Client.indices.delete.mockImplementation((params) => {
        callOrder.push(`delete:${params.index as string}`);
        return Promise.resolve(
          {} as unknown as Awaited<
            ReturnType<typeof mockES8Client.indices.delete>
          >,
        );
      });
      addAllAuditlogsSpy.mockImplementation(() => {
        callOrder.push('addAllAuditlogs');
        return Promise.resolve();
      });

      await delegator.rebuildAuditlogIndex();

      expect(callOrder).toEqual([
        'createAuditlogIndex:auditlogs-tmp',
        'reindex',
        'updateAliases',
        'delete:auditlogs',
        'createAuditlogIndex:auditlogs',
        'addAllAuditlogs',
        'updateAliases',
        'delete:auditlogs-tmp',
      ]);
    });

    it('should call normalizeAuditlogIndices and re-throw when an error occurs', async () => {
      const error = new Error('reindex failed');
      mockES8Client.reindex.mockRejectedValue(error);

      await expect(delegator.rebuildAuditlogIndex()).rejects.toThrow(
        'reindex failed',
      );
      expect(normalizeAuditlogIndicesSpy).toHaveBeenCalled();
    });

    it('should call logger.error and re-throw original error when normalizeAuditlogIndices also fails', async () => {
      const reindexError = new Error('reindex failed');
      const normalizeError = new Error('normalize failed');
      mockES8Client.reindex.mockRejectedValue(reindexError);
      normalizeAuditlogIndicesSpy.mockRejectedValue(normalizeError);

      await expect(delegator.rebuildAuditlogIndex()).rejects.toThrow(
        'reindex failed',
      );
      expect(mockError).toHaveBeenCalledWith(
        'Failed to restore auditlog indices',
        normalizeError,
      );
    });
  });

  describe('searchAuditlogByFuzzyWildcard()', () => {
    const makeBuckets = (keys: string[]) =>
      keys.map((key) => ({ key, doc_count: 1 }));

    describe('ES8/9 path', () => {
      let mockES8SearchClient: MockProxy<ES8ClientDelegator>;

      beforeEach(() => {
        mockES8SearchClient = mock<ES8ClientDelegator>({ delegatorVersion: 8 });
        // type-assertion (unavoidable): ES search response is a huge union; cast minimal shape.
        mockES8SearchClient.search.mockResolvedValue({
          aggregations: {
            unique_values: { buckets: makeBuckets(['alice', 'bob']) },
          },
        } as unknown as Awaited<ReturnType<typeof mockES8SearchClient.search>>);
        injectClient(delegator, mockES8SearchClient);
      });

      it('should escape *, ?, \\ in query', async () => {
        await delegator.searchAuditlogByFuzzyWildcard(
          'username',
          'a*b?c\\d',
          10,
        );

        expect(mockES8SearchClient.search).toHaveBeenCalledWith(
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

        expect(mockES8SearchClient.search).toHaveBeenCalledWith(
          expect.objectContaining({ index: 'auditlogs-alias' }),
        );
      });

      it('should use flat format without body wrapper', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 10);

        expect(mockES8SearchClient.search).toHaveBeenCalledWith(
          expect.objectContaining({ size: 0 }),
        );
        expect(mockES8SearchClient.search).not.toHaveBeenCalledWith(
          expect.objectContaining({ body: expect.anything() }),
        );
      });

      it('should pass limit to terms.size', async () => {
        await delegator.searchAuditlogByFuzzyWildcard('username', 'alice', 5);

        expect(mockES8SearchClient.search).toHaveBeenCalledWith(
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
        // type-assertion (unavoidable): invalid buckets on purpose to hit the non-array guard.
        mockES8SearchClient.search.mockResolvedValue({
          aggregations: { unique_values: { buckets: 'invalid' } },
        } as unknown as Awaited<ReturnType<typeof mockES8SearchClient.search>>);

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
        // type-assertion (unavoidable): see ES8 path — ES response is a large union.
        mockES7Client.search.mockResolvedValue({
          aggregations: {
            unique_values: { buckets: makeBuckets(['alice']) },
          },
        } as unknown as Awaited<ReturnType<typeof mockES7Client.search>>);
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
        // type-assertion (unavoidable): 0 is outside the 7|8|9 union, to hit the fallback.
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
});
