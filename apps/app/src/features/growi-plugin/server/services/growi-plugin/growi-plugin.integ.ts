import fs from 'node:fs';
import path from 'node:path';

import { PLUGIN_STORING_PATH } from '../../consts';
import { GrowiPlugin } from '../../models';
import { growiPluginService } from './growi-plugin';

// install() downloads and unzips a real GitHub archive over the network, so a
// network blip can fail it. An attempt has to be over before the next one
// starts, or the two would share the same temporary files: the timeout is
// longer than the 30s download limit in growi-plugin.ts, which makes a stalled
// attempt reject and clean up within it.
const NETWORK_INSTALL_TEST_TIMEOUT = 40_000;
const NETWORK_INSTALL_RETRY = 2;

describe('Installing a GROWI template plugin', {
  retry: NETWORK_INSTALL_RETRY,
}, () => {
  it(
    'install() should success',
    async () => {
      // when
      const result = await growiPluginService.install({
        url: 'https://github.com/growilabs/growi-plugin-templates-for-office',
      });
      const count = await GrowiPlugin.count({
        'meta.name': 'growi-plugin-templates-for-office',
      });

      // expect
      expect(result).toEqual('growi-plugin-templates-for-office');
      expect(count).toBe(1);
      expect(
        fs.existsSync(
          path.join(
            PLUGIN_STORING_PATH,
            'growilabs',
            'growi-plugin-templates-for-office',
          ),
        ),
      ).toBeTruthy();
    },
    NETWORK_INSTALL_TEST_TIMEOUT,
  );

  it(
    'install() should success (re-install)',
    async () => {
      // confirm
      const count1 = await GrowiPlugin.count({
        'meta.name': 'growi-plugin-templates-for-office',
      });
      expect(count1).toBe(1);

      // setup
      const dummyFilePath = path.join(
        PLUGIN_STORING_PATH,
        'growilabs',
        'growi-plugin-templates-for-office',
        'dummy.txt',
      );
      fs.appendFileSync(dummyFilePath, '');
      expect(fs.existsSync(dummyFilePath)).toBeTruthy();

      // when
      const result = await growiPluginService.install({
        url: 'https://github.com/growilabs/growi-plugin-templates-for-office',
      });
      const count2 = await GrowiPlugin.count({
        'meta.name': 'growi-plugin-templates-for-office',
      });

      // expect
      expect(result).toEqual('growi-plugin-templates-for-office');
      expect(count2).toBe(1);
      expect(fs.existsSync(dummyFilePath)).toBeFalsy(); // the dummy file should be removed
    },
    NETWORK_INSTALL_TEST_TIMEOUT,
  );
});

describe('Installing a GROWI theme plugin', {
  retry: NETWORK_INSTALL_RETRY,
}, () => {
  it(
    'install() should success',
    async () => {
      // when
      const result = await growiPluginService.install({
        url: 'https://github.com/growilabs/growi-plugin-theme-vivid-internet',
      });
      const count = await GrowiPlugin.count({
        'meta.name': 'growi-plugin-theme-vivid-internet',
      });

      // expect
      expect(result).toEqual('growi-plugin-theme-vivid-internet');
      expect(count).toBe(1);
      expect(
        fs.existsSync(
          path.join(
            PLUGIN_STORING_PATH,
            'growilabs',
            'growi-plugin-theme-vivid-internet',
          ),
        ),
      ).toBeTruthy();
    },
    NETWORK_INSTALL_TEST_TIMEOUT,
  );

  it('findThemePlugin() should return data with metadata and manifest', async () => {
    // confirm
    const count = await GrowiPlugin.count({
      'meta.name': 'growi-plugin-theme-vivid-internet',
    });
    expect(count).toBe(1);

    // when
    const results = await growiPluginService.findThemePlugin('vivid-internet');

    // expect
    expect(results).not.toBeNull();
    assert(results != null);
    expect(results.growiPlugin).not.toBeNull();
    expect(results.themeMetadata).not.toBeNull();
    expect(results.themeHref).not.toBeNull();
    expect(
      results.themeHref?.startsWith(
        '/static/plugins/growilabs/growi-plugin-theme-vivid-internet/dist/assets/style-',
      ),
    ).toBeTruthy();
  });
});
