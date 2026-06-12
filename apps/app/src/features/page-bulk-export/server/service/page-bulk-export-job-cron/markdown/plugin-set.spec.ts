/**
 * Tests for the plugin-set declaration module.
 *
 * Observable: "宣言モジュールが採用/除外の両集合を機械可読に公開する"
 *
 * Verifies:
 *  - Adopted and excluded sets are non-empty
 *  - Adopted set contains all 9 required plugins in pipeline order
 *  - Excluded set contains all listed intentionally-excluded plugins
 *  - No plugin appears in both adopted and excluded sets
 *  - Sets export as machine-readable (iterable/Set)
 */
import { describe, expect, it } from 'vitest';

import {
  ADOPTED_PLUGIN_NAMES,
  ADOPTED_PLUGINS,
  EXCLUDED_PLUGIN_NAMES,
  INTENTIONALLY_EXCLUDED_PLUGINS,
} from './plugin-set';

describe('plugin-set declaration module', () => {
  describe('ADOPTED_PLUGINS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(ADOPTED_PLUGINS)).toBe(true);
      expect(ADOPTED_PLUGINS.length).toBeGreaterThan(0);
    });

    it('contains all 9 required plugins', () => {
      const requiredPlugins = [
        'remark-gfm',
        'remark-frontmatter',
        'remark-math',
        'remark-rehype',
        'rehype-raw',
        'rehype-slug',
        'rehype-sanitize',
        'rehype-katex',
        'rehype-stringify',
      ];
      for (const plugin of requiredPlugins) {
        expect(
          ADOPTED_PLUGIN_NAMES.has(plugin),
          `Expected ADOPTED_PLUGINS to contain "${plugin}"`,
        ).toBe(true);
      }
    });

    it('contains remark-gfm before remark-frontmatter (pipeline order)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const gfmIndex = names.indexOf('remark-gfm');
      const frontmatterIndex = names.indexOf('remark-frontmatter');
      expect(gfmIndex).toBeGreaterThanOrEqual(0);
      expect(frontmatterIndex).toBeGreaterThanOrEqual(0);
      expect(gfmIndex).toBeLessThan(frontmatterIndex);
    });

    it('contains remark-math before remark-rehype (pipeline order)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const mathIndex = names.indexOf('remark-math');
      const rehypeIndex = names.indexOf('remark-rehype');
      expect(mathIndex).toBeGreaterThanOrEqual(0);
      expect(rehypeIndex).toBeGreaterThanOrEqual(0);
      expect(mathIndex).toBeLessThan(rehypeIndex);
    });

    it('contains remark-rehype before rehype-raw (pipeline order: mdast→hast then raw)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const remarkRehypeIndex = names.indexOf('remark-rehype');
      const rehypeRawIndex = names.indexOf('rehype-raw');
      expect(remarkRehypeIndex).toBeGreaterThanOrEqual(0);
      expect(rehypeRawIndex).toBeGreaterThanOrEqual(0);
      expect(remarkRehypeIndex).toBeLessThan(rehypeRawIndex);
    });

    it('contains rehype-raw before rehype-sanitize (sanitize must be after raw)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const rawIndex = names.indexOf('rehype-raw');
      const sanitizeIndex = names.indexOf('rehype-sanitize');
      expect(rawIndex).toBeGreaterThanOrEqual(0);
      expect(sanitizeIndex).toBeGreaterThanOrEqual(0);
      expect(rawIndex).toBeLessThan(sanitizeIndex);
    });

    it('contains rehype-sanitize before rehype-katex (katex output is trusted, placed after sanitize)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const sanitizeIndex = names.indexOf('rehype-sanitize');
      const katexIndex = names.indexOf('rehype-katex');
      expect(sanitizeIndex).toBeGreaterThanOrEqual(0);
      expect(katexIndex).toBeGreaterThanOrEqual(0);
      expect(sanitizeIndex).toBeLessThan(katexIndex);
    });

    it('contains rehype-stringify as the last plugin', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const lastPlugin = names[names.length - 1];
      expect(lastPlugin).toBe('rehype-stringify');
    });

    it('contains add-class after rehype-sanitize and before rehype-stringify (table classes)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const sanitizeIndex = names.indexOf('rehype-sanitize');
      const addClassIndex = names.indexOf('add-class');
      const stringifyIndex = names.indexOf('rehype-stringify');
      expect(addClassIndex).toBeGreaterThan(sanitizeIndex);
      expect(addClassIndex).toBeLessThan(stringifyIndex);
    });

    // 改訂 5: React/DOM-free plugins adopted by reuse.
    it('adopts emoji, remark-directive, echo-directive and xsv-to-table (改訂 5)', () => {
      for (const plugin of [
        'emoji',
        'remark-directive',
        'echo-directive',
        'xsv-to-table',
      ]) {
        expect(
          ADOPTED_PLUGIN_NAMES.has(plugin),
          `Expected ADOPTED_PLUGINS to contain "${plugin}"`,
        ).toBe(true);
      }
    });

    it('orders emoji before remark-directive (so :smile: is not parsed as a directive)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      expect(names.indexOf('emoji')).toBeLessThan(
        names.indexOf('remark-directive'),
      );
    });

    it('orders remark-directive before echo-directive (parser must run before the echo transform)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      expect(names.indexOf('remark-directive')).toBeLessThan(
        names.indexOf('echo-directive'),
      );
    });

    it('orders xsv-to-table before remark-rehype (it must transform mdast before the hast bridge)', () => {
      const names = ADOPTED_PLUGINS.map((p) => p.name);
      const xsvIndex = names.indexOf('xsv-to-table');
      expect(xsvIndex).toBeGreaterThanOrEqual(0);
      expect(xsvIndex).toBeLessThan(names.indexOf('remark-rehype'));
    });

    it('emoji, echo-directive and xsv-to-table declare relative specifiers and named exports', () => {
      for (const name of ['emoji', 'echo-directive', 'xsv-to-table']) {
        const entry = ADOPTED_PLUGINS.find((p) => p.name === name);
        expect(entry?.specifier, `${name} specifier`).toMatch(
          /remark-plugins\/.+\.ts$/,
        );
        expect(entry?.exportName, `${name} exportName`).toBe('remarkPlugin');
      }
    });

    it('add-class declares a relative specifier, named export, and table additions', () => {
      const addClass = ADOPTED_PLUGINS.find((p) => p.name === 'add-class');
      expect(addClass?.specifier).toMatch(/add-class\.ts$/);
      expect(addClass?.exportName).toBe('rehypePlugin');
      expect(addClass?.options).toEqual({ table: 'table table-bordered' });
    });

    it('remark-rehype declares allowDangerousHtml option', () => {
      const remarkRehype = ADOPTED_PLUGINS.find(
        (p) => p.name === 'remark-rehype',
      );
      expect(remarkRehype).toBeDefined();
      expect(remarkRehype?.options).toMatchObject({ allowDangerousHtml: true });
    });

    it('each entry has a name property (machine-readable structure)', () => {
      for (const plugin of ADOPTED_PLUGINS) {
        expect(typeof plugin.name).toBe('string');
        expect(plugin.name.length).toBeGreaterThan(0);
      }
    });
  });

  describe('INTENTIONALLY_EXCLUDED_PLUGINS', () => {
    it('is a non-empty readonly array', () => {
      expect(Array.isArray(INTENTIONALLY_EXCLUDED_PLUGINS)).toBe(true);
      expect(INTENTIONALLY_EXCLUDED_PLUGINS.length).toBeGreaterThan(0);
    });

    it('contains all listed intentionally-excluded plugins', () => {
      const expectedExcluded = [
        'pukiwiki-like-linker',
        'growi-directive',
        'codeblock',
        'github-admonitions',
        'callout',
        'add-inline-code',
        'relative-links',
        'remark-breaks',
      ];
      for (const plugin of expectedExcluded) {
        expect(
          EXCLUDED_PLUGIN_NAMES.has(plugin),
          `Expected INTENTIONALLY_EXCLUDED_PLUGINS to contain "${plugin}"`,
        ).toBe(true);
      }
    });

    // 改訂 5: these were excluded before but are now adopted (React/DOM-free reuse).
    it('no longer excludes emoji / xsv-to-table / remark-directive / echo-directive', () => {
      for (const plugin of [
        'emoji',
        'xsv-to-table',
        'remark-directive',
        'echo-directive',
      ]) {
        expect(
          EXCLUDED_PLUGIN_NAMES.has(plugin),
          `Expected "${plugin}" to NOT be in INTENTIONALLY_EXCLUDED_PLUGINS (改訂 5)`,
        ).toBe(false);
      }
    });
  });

  describe('ADOPTED_PLUGIN_NAMES', () => {
    it('is a Set (machine-readable)', () => {
      expect(ADOPTED_PLUGIN_NAMES).toBeInstanceOf(Set);
    });

    it('is iterable', () => {
      expect(() => [...ADOPTED_PLUGIN_NAMES]).not.toThrow();
    });

    it('has size equal to ADOPTED_PLUGINS length', () => {
      expect(ADOPTED_PLUGIN_NAMES.size).toBe(ADOPTED_PLUGINS.length);
    });
  });

  describe('EXCLUDED_PLUGIN_NAMES', () => {
    it('is a Set (machine-readable)', () => {
      expect(EXCLUDED_PLUGIN_NAMES).toBeInstanceOf(Set);
    });

    it('is iterable', () => {
      expect(() => [...EXCLUDED_PLUGIN_NAMES]).not.toThrow();
    });

    it('has size equal to INTENTIONALLY_EXCLUDED_PLUGINS length', () => {
      expect(EXCLUDED_PLUGIN_NAMES.size).toBe(
        INTENTIONALLY_EXCLUDED_PLUGINS.length,
      );
    });
  });

  describe('disjointness invariant', () => {
    it('no plugin name appears in both adopted and excluded sets', () => {
      const overlap = [...ADOPTED_PLUGIN_NAMES].filter((name) =>
        EXCLUDED_PLUGIN_NAMES.has(name),
      );
      expect(overlap).toHaveLength(0);
    });
  });
});
