import { vi } from 'vitest';

import { configManager } from '~/server/service/config-manager';

import { getInstance } from '../../../../test/setup/crowi';
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
      const delegator = new ElasticsearchDelegator(crowi.socketIoService);
      type WithRebuildIndex = {
        rebuildIndex: (option?: {
          shouldEmitProgress?: boolean;
        }) => Promise<void>;
      };
      const rebuildSpy = vi.spyOn(
        delegator as unknown as WithRebuildIndex,
        'rebuildIndex',
      );

      // act
      await delegator.init();

      // assert
      expect(rebuildSpy).toHaveBeenCalledOnce();
    }, 60_000);

    it('should leave indices in normalized state', async () => {
      // arrange
      const crowi = await getInstance();
      const delegator = new ElasticsearchDelegator(crowi.socketIoService);

      // act
      await delegator.init();

      // assert
      const { isNormalized } = await delegator.getInfoForAdmin();
      expect(isNormalized).toBe(true);
    }, 60_000);
  });
});
