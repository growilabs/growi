import mongoose from 'mongoose';
import { vi } from 'vitest';
import { type DeepMockProxy, mock, mockDeep } from 'vitest-mock-extended';

import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import { SocketIoService } from '~/server/service/socket-io/socket-io';

import { getInstance } from '../../../../test/setup/crowi';
import type { RebuildIndexOption } from '../interfaces/search';
import ElasticsearchDelegator from './elasticsearch';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';
import type { ES8ClientDelegator } from './elasticsearch-client-delegator/es8-client-delegator';

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

describe('ElasticsearchDelegator', () => {
  let delegator: ElasticsearchDelegator;
  let mockES8Client: DeepMockProxy<ES8ClientDelegator>;

  beforeEach(async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key) => {
      if (key === 'app:elasticsearchVersion') return 8;
      if (key === 'app:elasticsearchReindexBulkSize') return 100;
      return false;
    });

    const mockSocketIo = mock<SocketIoService>();
    delegator = new ElasticsearchDelegator(mockSocketIo);

    mockES8Client = mockDeep<ES8ClientDelegator>({ delegatorVersion: 8 });
    mockES8Client.bulk.mockResolvedValue({
      errors: false,
      items: [],
    } as unknown as Awaited<ReturnType<typeof mockES8Client.bulk>>);
    (delegator as unknown as { client: ElasticsearchClientDelegator }).client =
      mockES8Client;

    await Activity.deleteMany({});
  });

  describe('addAllAuditlogs()', () => {
    it('should call bulk with correct body for each activity in MongoDB', async () => {
      const id1 = new mongoose.Types.ObjectId();
      const id2 = new mongoose.Types.ObjectId();

      await mongoose.connection.collection('activities').insertMany([
        { _id: id1, snapshot: { username: 'alice' } },
        { _id: id2, snapshot: { username: 'bob' } },
      ]);

      await delegator.addAllAuditlogs();

      expect(mockES8Client.bulk).toHaveBeenCalledOnce();
      expect(mockES8Client.bulk).toHaveBeenCalledWith({
        body: expect.arrayContaining([
          { index: { _index: 'auditlogs-alias', _id: id1.toString() } },
          { username: 'alice' },
          { index: { _index: 'auditlogs-alias', _id: id2.toString() } },
          { username: 'bob' },
        ]),
      });
    });

    it('should not call bulk when no activities exist in MongoDB', async () => {
      await delegator.addAllAuditlogs();

      expect(mockES8Client.bulk).not.toHaveBeenCalled();
    });
  });
});

// ELASTICSEARCH_URI is mapped from VITE_ELASTICSEARCH_URI by test/setup/elasticsearch.ts
const hasElasticsearch = !!process.env.ELASTICSEARCH_URI;

describe.skipIf(!hasElasticsearch)(
  'ElasticsearchDelegator#init() with ELASTICSEARCH_REINDEX_ON_BOOT',
  () => {
    // Execute sequentially to use the same index name
    describe.sequential('when ELASTICSEARCH_REINDEX_ON_BOOT=true', () => {
      beforeAll(async () => {
        process.env.ELASTICSEARCH_REINDEX_ON_BOOT = 'true';
        await configManager.loadConfigs();
      });
      afterAll(() => {
        delete process.env.ELASTICSEARCH_REINDEX_ON_BOOT;
      });

      describe('with a SocketIoService with an attached dummy HTTP server', () => {
        it('should invoke rebuildIndex and complete without error', async () => {
          // arrange
          const crowi = await getInstance(); // attached SocketIoService with dummy server in setupCrowi.ts
          const delegator = new ElasticsearchDelegator(crowi.socketIoService);
          type WithRebuildIndex = {
            rebuildIndex: (option?: RebuildIndexOption) => Promise<void>;
          };
          const rebuildSpy = vi.spyOn(
            delegator as unknown as WithRebuildIndex,
            'rebuildIndex',
          );

          // act
          await delegator.init();

          // assert
          expect(rebuildSpy).toHaveBeenCalledOnce();
          const { isNormalized } = await delegator.getInfoForAdmin();
          expect(isNormalized).toBe(true);
          await expect(
            rebuildSpy.mock.results[0].value,
          ).resolves.toBeUndefined();
        }, 60_000);
      });

      describe('with a SocketIoService without an attached HTTP server', () => {
        it('should invoke rebuildIndex and complete without error', async () => {
          // arrange
          const crowi = await getInstance();
          // Use a SocketIoService without an attached HTTP server, as in actual boot.
          // If rebuildIndex incorrectly emits progress, getAdminSocket() throws.
          const socketIoService = new SocketIoService(crowi);
          const delegator = new ElasticsearchDelegator(socketIoService);
          type WithRebuildIndex = {
            rebuildIndex: (option?: RebuildIndexOption) => Promise<void>;
          };
          const rebuildSpy = vi.spyOn(
            delegator as unknown as WithRebuildIndex,
            'rebuildIndex',
          );

          // act
          await delegator.init();

          // assert
          expect(rebuildSpy).toHaveBeenCalledOnce();
          const { isNormalized } = await delegator.getInfoForAdmin();
          expect(isNormalized).toBe(true);
          await expect(
            rebuildSpy.mock.results[0].value,
          ).resolves.toBeUndefined();
        }, 60_000);
      });
    });
  },
);
