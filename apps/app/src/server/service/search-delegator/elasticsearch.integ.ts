import { vi } from 'vitest';

import { getInstance } from '../../../../test/setup/crowi';
import { configManager } from '../config-manager';
import type { RebuildIndexOption } from '../interfaces/search';
import { SocketIoService } from '../socket-io/socket-io';
import ElasticsearchDelegator from './elasticsearch';

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
