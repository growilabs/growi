import { describe, expect, it } from 'vitest';

import { loadPlugins } from './esm-plugin-loader';

/**
 * Verifies that EsmPluginLoader loads all required unified/remark/rehype ESM plugins
 * via dynamicImport without triggering ERR_REQUIRE_ESM in the current CJS runtime.
 *
 * This is an observable-contract test (Requirement 5.4): the loader must work in the
 * existing server runtime without requiring a full ESM migration of the repository.
 * What we observe is not the internals of dynamicImport, but rather that all declared
 * plugins are callable functions that can be handed to a unified pipeline.
 */
describe('EsmPluginLoader', () => {
  describe('loadPlugins()', () => {
    it('loads all plugins without ERR_REQUIRE_ESM', async () => {
      // Should not throw ERR_REQUIRE_ESM or any other import error
      await expect(loadPlugins(__dirname)).resolves.toBeDefined();
    });

    it('returns unified as a callable function', async () => {
      const plugins = await loadPlugins(__dirname);
      expect(typeof plugins.unified).toBe('function');
    });

    it('returns all remark plugins as callable functions', async () => {
      const plugins = await loadPlugins(__dirname);
      expect(typeof plugins.remarkParse).toBe('function');
      expect(typeof plugins.remarkGfm).toBe('function');
      expect(typeof plugins.remarkFrontmatter).toBe('function');
      expect(typeof plugins.remarkMath).toBe('function');
      expect(typeof plugins.remarkRehype).toBe('function');
    });

    it('returns all rehype plugins as callable functions', async () => {
      const plugins = await loadPlugins(__dirname);
      expect(typeof plugins.rehypeRaw).toBe('function');
      expect(typeof plugins.rehypeSlug).toBe('function');
      expect(typeof plugins.rehypeSanitize).toBe('function');
      expect(typeof plugins.rehypeKatex).toBe('function');
      expect(typeof plugins.rehypeStringify).toBe('function');
    });

    it('returns the same cached instance on repeated calls', async () => {
      const first = await loadPlugins(__dirname);
      const second = await loadPlugins(__dirname);
      // Cache ensures referential identity — same object returned
      expect(first).toBe(second);
    });

    it('the returned unified function can start a pipeline with all plugins without throwing', async () => {
      const plugins = await loadPlugins(__dirname);
      // Verify the plugins are usable by unified (Req 1.6: structural alignment with web renderer)
      const processor = plugins
        .unified()
        .use(plugins.remarkParse)
        .use(plugins.remarkGfm)
        .use(plugins.remarkFrontmatter)
        .use(plugins.remarkMath)
        .use(
          plugins.remarkRehype as Parameters<
            ReturnType<typeof plugins.unified>['use']
          >[0],
          { allowDangerousHtml: true },
        )
        .use(plugins.rehypeRaw)
        .use(plugins.rehypeSlug)
        .use(plugins.rehypeSanitize)
        .use(plugins.rehypeKatex)
        .use(plugins.rehypeStringify);

      const result = await processor.process('# Hello');
      expect(result.toString()).toContain('<h1');
    });
  });
});
