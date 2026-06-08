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

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

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
  });
});
