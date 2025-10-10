import { GrowiPluginType } from '@growi/core';

import { GrowiPlugin } from './growi-plugin';

describe('GrowiPlugin find methods', () => {
  beforeAll(async () => {
    await GrowiPlugin.insertMany([
      {
        isEnabled: false,
        installedPath: 'growilabs/growi-plugin-unenabled1',
        organizationName: 'growilabs',
        origin: {
          url: 'https://github.com/growilabs/growi-plugin-unenabled1',
        },
        meta: {
          name: '@growi/growi-plugin-unenabled1',
          types: [GrowiPluginType.Script],
        },
      },
      {
        isEnabled: false,
        installedPath: 'growilabs/growi-plugin-unenabled2',
        organizationName: 'growilabs',
        origin: {
          url: 'https://github.com/growilabs/growi-plugin-unenabled2',
        },
        meta: {
          name: '@growi/growi-plugin-unenabled2',
          types: [GrowiPluginType.Template],
        },
      },
      {
        isEnabled: true,
        installedPath: 'growilabs/growi-plugin-example1',
        organizationName: 'growilabs',
        origin: {
          url: 'https://github.com/growilabs/growi-plugin-example1',
        },
        meta: {
          name: '@growi/growi-plugin-example1',
          types: [GrowiPluginType.Script],
        },
      },
      {
        isEnabled: true,
        installedPath: 'growilabs/growi-plugin-example2',
        organizationName: 'growilabs',
        origin: {
          url: 'https://github.com/growilabs/growi-plugin-example2',
        },
        meta: {
          name: '@growi/growi-plugin-example2',
          types: [GrowiPluginType.Template],
        },
      },
    ]);
  });

  afterAll(async () => {
    await GrowiPlugin.deleteMany({});
  });

  describe.concurrent('.findEnabledPlugins', () => {
    it('shoud returns documents which isEnabled is true', async () => {
      // when
      const results = await GrowiPlugin.findEnabledPlugins();

      const pluginNames = results.map((p) => p.meta.name);

      // then
      expect(results.length === 2).toBeTruthy();
      expect(pluginNames.includes('@growi/growi-plugin-example1')).toBeTruthy();
      expect(pluginNames.includes('@growi/growi-plugin-example2')).toBeTruthy();
    });
  });

  describe.concurrent('.findEnabledPluginsByType', () => {
    it("shoud returns documents which type is 'template'", async () => {
      // when
      const results = await GrowiPlugin.findEnabledPluginsByType(
        GrowiPluginType.Template,
      );

      const pluginNames = results.map((p) => p.meta.name);

      // then
      expect(results.length === 1).toBeTruthy();
      expect(pluginNames.includes('@growi/growi-plugin-example2')).toBeTruthy();
    });
  });
});

describe('GrowiPlugin activate/deactivate', () => {
  beforeAll(async () => {
    await GrowiPlugin.insertMany([
      {
        isEnabled: false,
        installedPath: 'growilabs/growi-plugin-example1',
        organizationName: 'growilabs',
        origin: {
          url: 'https://github.com/growilabs/growi-plugin-example1',
        },
        meta: {
          name: '@growi/growi-plugin-example1',
          types: [GrowiPluginType.Script],
        },
      },
    ]);
  });

  afterAll(async () => {
    await GrowiPlugin.deleteMany({});
  });

  describe('.activatePlugin', () => {
    it('shoud update the property "isEnabled" to true', async () => {
      // setup
      const plugin = await GrowiPlugin.findOne({});
      assert(plugin != null);

      expect(plugin.isEnabled).toBeFalsy(); // isEnabled: false

      // when
      const result = await GrowiPlugin.activatePlugin(plugin._id);
      const pluginAfterActivated = await GrowiPlugin.findOne({
        _id: plugin._id,
      });

      // then
      expect(result).toEqual('@growi/growi-plugin-example1'); // equals to meta.name
      expect(pluginAfterActivated).not.toBeNull();
      assert(pluginAfterActivated != null);
      expect(pluginAfterActivated.isEnabled).toBeTruthy(); // isEnabled: true
    });
  });

  describe('.deactivatePlugin', () => {
    it('shoud update the property "isEnabled" to true', async () => {
      // setup
      const plugin = await GrowiPlugin.findOne({});
      assert(plugin != null);

      expect(plugin.isEnabled).toBeTruthy(); // isEnabled: true

      // when
      const result = await GrowiPlugin.deactivatePlugin(plugin._id);
      const pluginAfterActivated = await GrowiPlugin.findOne({
        _id: plugin._id,
      });

      // then
      expect(result).toEqual('@growi/growi-plugin-example1'); // equals to meta.name
      expect(pluginAfterActivated).not.toBeNull();
      assert(pluginAfterActivated != null);
      expect(pluginAfterActivated.isEnabled).toBeFalsy(); // isEnabled: false
    });
  });
});
