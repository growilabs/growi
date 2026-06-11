import { describe, expect, it } from 'vitest';

import { loadPlugins } from './esm-plugin-loader';
import { ADOPTED_PLUGINS } from './plugin-set';

/**
 * Verifies that EsmPluginLoader loads `unified` and every plugin declared in
 * ADOPTED_PLUGINS via dynamicImport without triggering ERR_REQUIRE_ESM in the
 * current CJS runtime.
 *
 * This is an observable-contract test (Requirement 5.4): the loader must work in
 * the existing server runtime without a full ESM migration. What we observe is
 * not dynamicImport internals, but that the loader returns the unified factory
 * plus the ordered, callable plugin list declared in plugin-set.ts — the single
 * source of truth (Requirement 1.6).
 */
describe('EsmPluginLoader', () => {
  describe('loadPlugins()', () => {
    it('loads all plugins without ERR_REQUIRE_ESM', async () => {
      await expect(loadPlugins(__dirname)).resolves.toBeDefined();
    });

    it('returns unified as a callable function', async () => {
      const { unified } = await loadPlugins(__dirname);
      expect(typeof unified).toBe('function');
    });

    it('returns one loaded plugin per ADOPTED_PLUGINS entry, in declared order', async () => {
      const { plugins } = await loadPlugins(__dirname);
      // Single source of truth: the loaded list mirrors plugin-set.ts exactly.
      expect(plugins.map((p) => p.name)).toEqual(
        ADOPTED_PLUGINS.map((p) => p.name),
      );
    });

    it('returns every plugin as a callable function with its declared options', async () => {
      const { plugins } = await loadPlugins(__dirname);
      for (const loaded of plugins) {
        expect(typeof loaded.plugin).toBe('function');
      }
      // Static options from the declaration are carried through (e.g. remark-rehype).
      const remarkRehype = plugins.find((p) => p.name === 'remark-rehype');
      expect(remarkRehype?.options).toEqual({ allowDangerousHtml: true });
    });

    it('returns the same cached instance on repeated calls', async () => {
      const first = await loadPlugins(__dirname);
      const second = await loadPlugins(__dirname);
      expect(first).toBe(second);
    });

    it('the loaded plugins assemble into a working unified pipeline', async () => {
      const { unified, plugins } = await loadPlugins(__dirname);
      // Assemble exactly as the renderer does: iterate the declared order.
      // use() mutates in place and returns `this`, so call it for side effect.
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
