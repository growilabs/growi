import mongoose from 'mongoose';
import { vi } from 'vitest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import type { SocketIoService } from '~/server/service/socket-io';

import ElasticsearchDelegator from './elasticsearch';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';

const { mockError, mockWarn, mockInfo } = vi.hoisted(() => ({
  mockError: vi.fn(),
  mockWarn: vi.fn(),
  mockInfo: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
  })),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

describe('ElasticsearchDelegator', () => {
  let delegator: ElasticsearchDelegator;
  let mockSocketIo: MockProxy<SocketIoService>;
  let mockClient: { delegatorVersion: 8; bulk: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.mocked(configManager.getConfig).mockImplementation((key) => {
      if (key === 'app:elasticsearchVersion') return 8;
      return false;
    });

    mockSocketIo = mock<SocketIoService>();
    delegator = new ElasticsearchDelegator(mockSocketIo);

    mockClient = {
      delegatorVersion: 8,
      bulk: vi.fn().mockResolvedValue({ errors: false, items: [] }),
    };
    (delegator as unknown as { client: ElasticsearchClientDelegator }).client =
      mockClient as unknown as ElasticsearchClientDelegator;
  });

  describe('updateOrInsertAuditlog()', () => {
    it('should not call bulk when activity is null', async () => {
      await delegator.updateOrInsertAuditlog(null);

      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should not call bulk when snapshot.username is null', async () => {
      const activity = {
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username: null },
      } as unknown as ActivityDocument;

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should not call bulk when snapshot.username is empty string', async () => {
      const activity = {
        _id: new mongoose.Types.ObjectId(),
        snapshot: { username: '' },
      } as unknown as ActivityDocument;

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should call bulk with correct body for valid activity', async () => {
      const id = new mongoose.Types.ObjectId();
      const activity = {
        _id: id,
        snapshot: { username: 'test-user' },
      } as unknown as ActivityDocument;

      await delegator.updateOrInsertAuditlog(activity);

      expect(mockClient.bulk).toHaveBeenCalledWith({
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

      mockClient.bulk.mockResolvedValue({
        errors: true,
        items: [
          { index: { error: { type: 'mapper_exception', reason: 'failed' } } },
        ],
      });

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

      mockClient.bulk.mockRejectedValue(new Error('ES connection error'));

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
    let mockIndicesClient: {
      exists: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      existsAlias: ReturnType<typeof vi.fn>;
      putAlias: ReturnType<typeof vi.fn>;
    };
    let createAuditlogIndexSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockIndicesClient = {
        exists: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
        existsAlias: vi.fn(),
        putAlias: vi.fn().mockResolvedValue({}),
      };

      (
        delegator as unknown as { client: ElasticsearchClientDelegator }
      ).client = {
        delegatorVersion: 8,
        indices: mockIndicesClient,
      } as unknown as ElasticsearchClientDelegator;

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
      mockIndicesClient.exists
        .mockResolvedValueOnce(true) // auditlogs-tmp exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockIndicesClient.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(mockIndicesClient.delete).toHaveBeenCalledWith({
        index: 'auditlogs-tmp',
      });
    });

    it('should not delete tmp index when it does not exist', async () => {
      mockIndicesClient.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockIndicesClient.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(mockIndicesClient.delete).not.toHaveBeenCalled();
    });

    it('should call createAuditlogIndex when main index does not exist', async () => {
      mockIndicesClient.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(false); // auditlogs not exists
      mockIndicesClient.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(createAuditlogIndexSpy).toHaveBeenCalledWith('auditlogs');
    });

    it('should not call createAuditlogIndex when main index exists', async () => {
      mockIndicesClient.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockIndicesClient.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(createAuditlogIndexSpy).not.toHaveBeenCalled();
    });

    it('should call putAlias when alias does not exist', async () => {
      mockIndicesClient.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockIndicesClient.existsAlias.mockResolvedValue(false);

      await delegator.normalizeAuditlogIndices();

      expect(mockIndicesClient.existsAlias).toHaveBeenCalledWith({
        index: 'auditlogs',
        name: 'auditlogs-alias',
      });
      expect(mockIndicesClient.putAlias).toHaveBeenCalledWith({
        name: 'auditlogs-alias',
        index: 'auditlogs',
      });
    });

    it('should not call putAlias when alias exists', async () => {
      mockIndicesClient.exists
        .mockResolvedValueOnce(false) // auditlogs-tmp not exists
        .mockResolvedValueOnce(true); // auditlogs exists
      mockIndicesClient.existsAlias.mockResolvedValue(true);

      await delegator.normalizeAuditlogIndices();

      expect(mockIndicesClient.putAlias).not.toHaveBeenCalled();
    });
  });

  describe('rebuildAuditlogIndex()', () => {
    let mockIndicesClient: {
      updateAliases: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    let mockReindex: ReturnType<typeof vi.fn>;
    let createAuditlogIndexSpy: ReturnType<typeof vi.spyOn>;
    let addAllAuditlogsSpy: ReturnType<typeof vi.spyOn>;
    let normalizeAuditlogIndicesSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockIndicesClient = {
        updateAliases: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      };
      mockReindex = vi.fn().mockResolvedValue({});

      (
        delegator as unknown as { client: ElasticsearchClientDelegator }
      ).client = {
        delegatorVersion: 8,
        reindex: mockReindex,
        indices: mockIndicesClient,
      } as unknown as ElasticsearchClientDelegator;

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
      mockReindex.mockImplementation(() => {
        callOrder.push('reindex');
        return Promise.resolve();
      });
      mockIndicesClient.updateAliases.mockImplementation(() => {
        callOrder.push('updateAliases');
        return Promise.resolve();
      });
      mockIndicesClient.delete.mockImplementation(
        ({ index }: { index: string }) => {
          callOrder.push(`delete:${index}`);
          return Promise.resolve();
        },
      );
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
      mockReindex.mockRejectedValue(error);

      await expect(delegator.rebuildAuditlogIndex()).rejects.toThrow(
        'reindex failed',
      );
      expect(normalizeAuditlogIndicesSpy).toHaveBeenCalled();
    });
  });
});
