import { describe, expect, it } from 'vitest';

import { loadPlugins } from './esm-plugin-loader';
import { ADOPTED_PLUGINS } from './plugin-set';

/**
 * Verifies that EsmPluginLoader loads `unified` and every *declaration it is
 * given* via dynamicImport without triggering ERR_REQUIRE_ESM in the current CJS
 * runtime.
 *
 * This is an observable-contract test (Requirement 5.4): the loader must work in
 * the existing server runtime without a full ESM migration. The loader's only
 * responsibility is loading — the caller supplies *what* to load (the canonical
 * set lives in plugin-set.ts), so these tests pass declarations in explicitly.
 */
describe('EsmPluginLoader', () => {
  describe('loadPlugins(baseDir, declarations)', () => {
    it('loads all plugins without ERR_REQUIRE_ESM', async () => {
      await expect(
        loadPlugins(__dirname, ADOPTED_PLUGINS),
      ).resolves.toBeDefined();
    });

    it('returns unified as a callable function', async () => {
      const { unified } = await loadPlugins(__dirname, ADOPTED_PLUGINS);
      expect(typeof unified).toBe('function');
    });

    it('returns one loaded plugin per declaration, in the given order', async () => {
      const { plugins } = await loadPlugins(__dirname, ADOPTED_PLUGINS);
      // The loader preserves the caller's declaration order verbatim.
      expect(plugins.map((p) => p.name)).toEqual(
        ADOPTED_PLUGINS.map((p) => p.name),
      );
    });

    it('returns every plugin as a callable function carrying its declared options', async () => {
      const { plugins } = await loadPlugins(__dirname, ADOPTED_PLUGINS);
      for (const loaded of plugins) {
        expect(typeof loaded.plugin).toBe('function');
      }
      const remarkRehype = plugins.find((p) => p.name === 'remark-rehype');
      expect(remarkRehype?.options).toEqual({ allowDangerousHtml: true });
    });

    it('resolves a relative specifier + named export (reused local plugin)', async () => {
      // The add-class declaration loads a local GROWI .ts plugin by relative path
      // and a non-default export — exercising the loader's specifier/exportName
      // resolution independently of the npm bare-specifier path.
      const { plugins } = await loadPlugins(__dirname, ADOPTED_PLUGINS);
      const addClass = plugins.find((p) => p.name === 'add-class');
      expect(addClass).toBeDefined();
      expect(typeof addClass?.plugin).toBe('function');
      expect(addClass?.options).toEqual({ table: 'table table-bordered' });
    });

    it('throws a clear error when a declared export is missing', async () => {
      await expect(
        loadPlugins(__dirname, [
          { name: 'remark-gfm', exportName: 'doesNotExist' },
        ]),
      ).rejects.toThrow(/has no export "doesNotExist"/);
    });

    it('the loaded plugins assemble into a working unified pipeline', async () => {
      const { unified, plugins } = await loadPlugins(
        __dirname,
        ADOPTED_PLUGINS,
      );
      // Assemble as the renderer does: iterate in order. use() mutates in place
      // and returns `this`, so call it for side effect.
      const processor = unified();
      for (const { plugin, options } of plugins) {
        if (options != null) {
          processor.use(plugin, options);
        } else {
          processor.use(plugin);
        }
      }
      const result = await processor.process('# Hello');
      expect(result.toString()).toContain('<h1');
    });
  });
});
