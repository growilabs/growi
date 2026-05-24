import { vi } from 'vitest';

import { configManager } from '~/server/service/config-manager';
import { SocketIoService } from '~/server/service/socket-io/socket-io';

import { getInstance } from '../../../../test/setup/crowi';
import type { RebuildIndexOption } from '../interfaces/search';
import ElasticsearchDelegator from './elasticsearch';

describe('ElasticsearchDelegator#init() with ELASTICSEARCH_REINDEX_ON_BOOT', () => {
  describe('when ELASTICSEARCH_REINDEX_ON_BOOT=true', () => {
    beforeAll(async () => {
      process.env.ELASTICSEARCH_REINDEX_ON_BOOT = 'true';
      await configManager.loadConfigs();
    });
    afterAll(() => {
      delete process.env.ELASTICSEARCH_REINDEX_ON_BOOT;
    });

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
      await expect(rebuildSpy.mock.results[0].value).resolves.toBeUndefined();
    }, 60_000);
  });
});
