/**
 * RendererParityGuard — drift detection test (Requirements 6.1, 6.2)
 *
 * Observable: "bulk-export と Web レンダラのプラグイン集合の乖離をテストで検知できる"
 *
 * Strategy: Static source analysis of the server-side renderer
 * (`services/renderer/renderer.tsx`) which uses ESM static imports that cannot
 * be required in the CJS test runtime.  We read the source with `fs.readFileSync`
 * and extract:
 *   1. The set of plugin variables used inside `generateCommonOptions` (remarkPlugins +
 *      rehypePlugins arrays, including those added by `generateSSRViewOptions`).
 *   2. A mapping from each variable identifier to its canonical npm/local plugin name
 *      (aligned with the naming convention in `plugin-set.ts`).
 *
 * Then for each web plugin we assert that it appears in either
 * `ADOPTED_PLUGIN_NAMES` or `EXCLUDED_PLUGIN_NAMES`.  Conversely, every entry in
 * `ADOPTED_PLUGIN_NAMES` must correspond to at least one web plugin reference
 * (no bulk-export-only plugins without a Web counterpart).
 *
 * A new plugin added to the Web renderer without being classified in
 * `plugin-set.ts` will cause this test to FAIL.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ADOPTED_PLUGIN_NAMES, EXCLUDED_PLUGIN_NAMES } from './plugin-set';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Absolute path to the server-side renderer source.
 * `generateCommonOptions` and `generateSSRViewOptions` live here.
 */
const SERVER_RENDERER_PATH = resolve(
  __dirname,
  '../../../../../../services/renderer/renderer.tsx',
);

// ---------------------------------------------------------------------------
// Static source extraction helpers
// ---------------------------------------------------------------------------

/**
 * Read the renderer source and return it as a string.
 * Throws clearly if the file cannot be found.
 */
function readRendererSource(): string {
  if (!existsSync(SERVER_RENDERER_PATH)) {
    throw new Error(
      `Cannot find server renderer at: ${SERVER_RENDERER_PATH}\n` +
        'If the file was moved, update SERVER_RENDERER_PATH in renderer-parity.spec.ts.',
    );
  }
  return readFileSync(SERVER_RENDERER_PATH, 'utf-8');
}

/**
 * Build a map from the import identifier (as used in plugin arrays) to the
 * canonical plugin name (matching the naming convention of plugin-set.ts).
 *
 * Rules:
 *  - npm packages: use the package name directly
 *    e.g.  `import gfm from 'remark-gfm'`  →  gfm → 'remark-gfm'
 *    e.g.  `import slug from 'rehype-slug'` →  slug → 'rehype-slug'
 *    e.g.  `import growiDirective from '@growi/remark-growi-directive'` →
 *             growiDirective → 'growi-directive' (short name used in exclusion list)
 *  - Local plugins: map to the canonical short name used in plugin-set.ts
 *    e.g.  `import * as emoji from './remark-plugins/emoji'`  →
 *             emoji → 'emoji'
 *    e.g.  `import { pukiwikiLikeLinker } from './remark-plugins/pukiwiki-like-linker'` →
 *             pukiwikiLikeLinker → 'pukiwiki-like-linker'
 *
 * The returned map's keys are the TypeScript identifiers used in plugin arrays;
 * the values are canonical names matching plugin-set.ts.
 */
function buildPluginIdentifierMap(source: string): Map<string, string> {
  const map = new Map<string, string>();

  // Pattern 1: default import from npm package
  // e.g. import gfm from 'remark-gfm';
  // e.g. import growiDirective from '@growi/remark-growi-directive';
  for (const m of source.matchAll(/import\s+(\w+)\s+from\s+'([^']+)'/g)) {
    const identifier = m[1];
    const pkg = m[2];
    const canonical = npmPackageToCanonicalName(pkg);
    if (canonical !== null) {
      map.set(identifier, canonical);
    }
  }

  // Pattern 2: namespace import from local path
  // e.g. import * as emoji from './remark-plugins/emoji';
  // e.g. import * as addClass from './rehype-plugins/add-class';
  for (const m of source.matchAll(
    /import\s+\*\s+as\s+(\w+)\s+from\s+'(\.\/[^']+)'/g,
  )) {
    const identifier = m[1];
    const localPath = m[2];
    const canonical = localPathToCanonicalName(localPath);
    if (canonical !== null) {
      map.set(identifier, canonical);
    }
  }

  // Pattern 3: named import from local path
  // e.g. import { pukiwikiLikeLinker } from './remark-plugins/pukiwiki-like-linker';
  // e.g. import { relativeLinks } from './rehype-plugins/relative-links';
  for (const m of source.matchAll(
    /import\s+\{\s*(\w+)(?:\s*,\s*\w+)*\s*\}\s+from\s+'(\.\/[^']+)'/g,
  )) {
    const identifier = m[1];
    const localPath = m[2];
    const canonical = localPathToCanonicalName(localPath);
    if (canonical !== null) {
      map.set(identifier, canonical);
    }
  }

  return map;
}

/**
 * Convert an npm package name to the canonical plugin name used in plugin-set.ts.
 * Returns null for non-plugin packages (utilities, type imports, etc.)
 */
function npmPackageToCanonicalName(pkg: string): string | null {
  // Direct npm plugin packages (remark-*, rehype-*)
  if (pkg.startsWith('remark-') || pkg.startsWith('rehype-')) {
    return pkg; // e.g. 'remark-gfm', 'rehype-slug', 'rehype-katex'
  }
  // @growi scoped plugins
  if (pkg === '@growi/remark-growi-directive') {
    return 'growi-directive';
  }
  // Not a plugin
  return null;
}

/**
 * Convert a local import path (relative to renderer.tsx) to the canonical
 * plugin short name used in plugin-set.ts.
 */
function localPathToCanonicalName(localPath: string): string | null {
  // Extract the basename: './remark-plugins/emoji' → 'emoji'
  //                        './rehype-plugins/add-class' → 'add-class'
  const basename = localPath.split('/').pop() ?? '';
  // Map of local basename → canonical name (matching plugin-set.ts)
  const LOCAL_PLUGIN_MAP: Record<string, string> = {
    emoji: 'emoji',
    'pukiwiki-like-linker': 'pukiwiki-like-linker',
    'echo-directive': 'echo-directive',
    codeblock: 'codeblock',
    'xsv-to-table': 'xsv-to-table',
    'add-class': 'add-class',
    'add-inline-code-property': 'add-inline-code',
    'relative-links': 'relative-links',
    'relative-links-by-pukiwiki-like-linker': 'relative-links',
  };
  return LOCAL_PLUGIN_MAP[basename] ?? null;
}

// ---------------------------------------------------------------------------
// Plugin usage extraction
// ---------------------------------------------------------------------------

/**
 * Extract plugin identifiers that appear in `remarkPlugins` or `rehypePlugins`
 * arrays inside `generateCommonOptions` and `generateSSRViewOptions`.
 *
 * Handles:
 *  - Array literal:  `remarkPlugins: [gfm, emoji.remarkPlugin, ...]`
 *  - Push call:      `remarkPlugins.push(math, xsvToTable.remarkPlugin)`
 *  - Tuple entry:    `[relativeLinks, { pagePath }]`
 */
function extractWebPluginReferences(source: string): Set<string> {
  const refs = new Set<string>();

  // Capture the content between [ ] or ( ) after remarkPlugins/rehypePlugins
  for (const m of source.matchAll(
    /(?:remarkPlugins|rehypePlugins)[^;]*?(?:\[([^\]]*?)\]|\.push\(([^)]*)\))/gs,
  )) {
    const content = m[1] ?? m[2] ?? '';
    extractIdentifiersFromContent(content, refs);
  }

  return refs;
}

/** Keywords that appear near plugin arrays but are not plugin identifiers. */
const NON_PLUGIN_IDENTIFIERS = new Set([
  'if',
  'const',
  'let',
  'var',
  'true',
  'false',
  'null',
  'undefined',
  'isEnabledLinebreaks',
  'config',
  'pagePath',
  'shouldBeTheLastItem',
  'options',
]);

/**
 * From a string containing plugin entries (comma-separated), extract all
 * identifiers that could be plugin references.
 *
 * Handles:
 *  - `gfm`                      → 'gfm'
 *  - `emoji.remarkPlugin`       → 'emoji'
 *  - `[relativeLinks, { ... }]` → 'relativeLinks'
 *  - `() => {}`                 → skipped
 *  - `[sanitize, config]`       → 'sanitize'
 */
function extractIdentifiersFromContent(
  content: string,
  refs: Set<string>,
): void {
  for (const m of content.matchAll(
    /\[?\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g,
  )) {
    const base = m[1];
    if (!NON_PLUGIN_IDENTIFIERS.has(base)) {
      refs.add(base);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared parse state (lazily initialised once per test run)
// ---------------------------------------------------------------------------

let _source: string | undefined;
let _identifierMap: Map<string, string> | undefined;
let _pluginRefs: Set<string> | undefined;

/**
 * Resolve web plugin refs to canonical names.
 * Returns the set of canonical plugin names found in generateCommonOptions +
 * generateSSRViewOptions.
 */
function getWebCanonicalPluginNames(): Set<string> {
  _source ??= readRendererSource();
  _identifierMap ??= buildPluginIdentifierMap(_source);
  _pluginRefs ??= extractWebPluginReferences(_source);

  const canonical = new Set<string>();
  for (const ref of _pluginRefs) {
    const name = _identifierMap.get(ref);
    if (name != null) {
      canonical.add(name);
    }
  }
  return canonical;
}

// ---------------------------------------------------------------------------
// Test suite: RendererParityGuard
// ---------------------------------------------------------------------------

describe('RendererParityGuard — Web renderer plugin drift detection', () => {
  it('server renderer source file is reachable', () => {
    expect(() => readRendererSource()).not.toThrow();
  });

  it('extracts a non-empty set of canonical web plugin names', () => {
    const names = getWebCanonicalPluginNames();
    expect(names.size).toBeGreaterThan(0);
  });

  it('detects known remark-gfm in web plugin set (sanity)', () => {
    const names = getWebCanonicalPluginNames();
    expect(names.has('remark-gfm')).toBe(true);
  });

  it('detects known rehype-slug in web plugin set (sanity: SSRViewOptions addition)', () => {
    const names = getWebCanonicalPluginNames();
    expect(names.has('rehype-slug')).toBe(true);
  });

  it('detects known remark-math in web plugin set (sanity: SSRViewOptions addition)', () => {
    const names = getWebCanonicalPluginNames();
    expect(names.has('remark-math')).toBe(true);
  });

  /**
   * Core assertion 1 (Requirement 6.2):
   * Every plugin used by the Web renderer (generateCommonOptions +
   * generateSSRViewOptions) must be classified in plugin-set.ts as either
   * ADOPTED or INTENTIONALLY_EXCLUDED.
   *
   * Failure = unclassified new plugin added to the Web renderer.
   */
  it('every Web renderer plugin is classified as adopted or intentionally excluded', () => {
    const webPlugins = getWebCanonicalPluginNames();

    const unclassified: string[] = [];
    for (const name of webPlugins) {
      if (!ADOPTED_PLUGIN_NAMES.has(name) && !EXCLUDED_PLUGIN_NAMES.has(name)) {
        unclassified.push(name);
      }
    }

    expect(
      unclassified,
      `The following Web renderer plugins are not classified in plugin-set.ts:\n` +
        `  ${unclassified.join(', ')}\n` +
        `Add each to ADOPTED_PLUGINS or INTENTIONALLY_EXCLUDED_PLUGINS.`,
    ).toHaveLength(0);
  });

  /**
   * Core assertion 2 (Requirement 6.1):
   * Every plugin in ADOPTED_PLUGIN_NAMES must correspond to at least one plugin
   * in the Web renderer's selection (either generateCommonOptions or
   * generateSSRViewOptions).  This prevents bulk-export from adopting plugins
   * that have no Web counterpart.
   *
   * Exception: infrastructure plugins that are implicit in the unified pipeline
   * and are not listed as named identifiers in the web renderer's plugin arrays.
   */
  it('every adopted bulk-export plugin corresponds to a Web renderer plugin', () => {
    // These are part of the unified pipeline infrastructure: they are implicit
    // in the Web renderer (remark() base, bridge, serialiser) and are not
    // listed as named identifiers in the plugin arrays.
    const WEB_INFRASTRUCTURE_PLUGINS = new Set([
      'remark-parse', // implicit via remark() processor base
      'rehype-stringify', // final serialiser — not in web plugin arrays
      'remark-rehype', // mdast→hast bridge — not in web plugin arrays as a named var
      'rehype-raw', // paired with remark-rehype allowDangerousHtml
      // rehype-sanitize IS used by the web renderer but via an intermediate variable
      // (`const rehypeSanitizePlugin = ...`).  The static identifier extractor resolves
      // identifiers referenced directly in plugin arrays; it cannot follow local bindings.
      'rehype-sanitize',
    ]);

    const webPlugins = getWebCanonicalPluginNames();

    const orphanAdopted: string[] = [];
    for (const name of ADOPTED_PLUGIN_NAMES) {
      if (WEB_INFRASTRUCTURE_PLUGINS.has(name)) {
        continue;
      }
      if (!webPlugins.has(name)) {
        orphanAdopted.push(name);
      }
    }

    expect(
      orphanAdopted,
      `The following ADOPTED bulk-export plugins have no counterpart in the Web renderer:\n` +
        `  ${orphanAdopted.join(', ')}\n` +
        `Either the Web renderer should add them or they should be removed from ADOPTED_PLUGINS.`,
    ).toHaveLength(0);
  });
});
