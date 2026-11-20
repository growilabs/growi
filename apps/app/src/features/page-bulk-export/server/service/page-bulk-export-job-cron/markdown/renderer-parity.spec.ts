/**
 * RendererParityGuard — drift detection test (Requirements 6.1, 6.2)
 *
 * Observable: "bulk-export と Web レンダラのプラグイン集合の乖離をテストで検知できる"
 *
 * Strategy: parse the server-side renderer source
 * (`services/renderer/renderer.tsx`, which defines both `generateCommonOptions`
 * and `generateSSRViewOptions`) with the TypeScript compiler and read its
 * **import declarations** via the AST. A plugin can only be used by the renderer
 * if it is imported, so the set of imported plugin packages is the authoritative
 * universe of plugins the renderer depends on.
 *
 * AST-based import extraction is robust to formatting, comments, multi-line
 * imports, and array-vs-push usage — unlike a regex scan of the plugin arrays,
 * it does not need hand-maintained identifier blocklists and fails loudly
 * (empty set / unreadable file) rather than silently under-reporting drift.
 *
 * For each imported plugin we assert it is classified in plugin-set.ts as either
 * ADOPTED or INTENTIONALLY_EXCLUDED; conversely every ADOPTED plugin (minus the
 * unified pipeline infrastructure the web renderer gets implicitly from
 * react-markdown) must be imported by the renderer. A new plugin import added to
 * the web renderer without classification makes this test FAIL.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { ADOPTED_PLUGIN_NAMES, EXCLUDED_PLUGIN_NAMES } from './plugin-set';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Absolute path to the server-side renderer source.
 * `generateCommonOptions` and `generateSSRViewOptions` both live here, and all
 * their plugins are imported at the top of this file.
 */
const SERVER_RENDERER_PATH = resolve(
  __dirname,
  '../../../../../../services/renderer/renderer.tsx',
);

// ---------------------------------------------------------------------------
// Canonical-name mapping (import specifier → plugin-set.ts canonical name)
// ---------------------------------------------------------------------------

/**
 * Convert an npm package specifier to the canonical plugin name used in
 * plugin-set.ts. Returns null for non-plugin packages (utilities, type imports).
 */
function npmPackageToCanonicalName(pkg: string): string | null {
  if (pkg.startsWith('remark-') || pkg.startsWith('rehype-')) {
    return pkg; // e.g. 'remark-gfm', 'rehype-slug', 'rehype-katex'
  }
  if (pkg === '@growi/remark-growi-directive') {
    return 'growi-directive';
  }
  return null;
}

/** Local import basename → canonical name used in plugin-set.ts. */
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

/**
 * Convert a relative import path (e.g. './remark-plugins/emoji') to the
 * canonical plugin short name. Returns null for non-plugin local modules.
 */
function localPathToCanonicalName(localPath: string): string | null {
  const basename = localPath.split('/').pop() ?? '';
  return LOCAL_PLUGIN_MAP[basename] ?? null;
}

/**
 * Map an import specifier to its canonical plugin name, or null if it is not a
 * rendering plugin.
 */
function specifierToCanonicalName(specifier: string): string | null {
  return specifier.startsWith('.')
    ? localPathToCanonicalName(specifier)
    : npmPackageToCanonicalName(specifier);
}

// ---------------------------------------------------------------------------
// AST import extraction
// ---------------------------------------------------------------------------

/**
 * Parse the renderer source and return the set of canonical plugin names it
 * imports. Uses the TypeScript AST so the result is independent of formatting,
 * comments, and how the plugins are later referenced.
 */
function extractImportedPluginNames(source: string): Set<string> {
  const sourceFile = ts.createSourceFile(
    'renderer.tsx',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const canonical = specifierToCanonicalName(
        statement.moduleSpecifier.text,
      );
      if (canonical != null) {
        names.add(canonical);
      }
    }
  }
  return names;
}

let _webPlugins: Set<string> | undefined;

/** Lazily parse the renderer once and cache the canonical plugin name set. */
function getWebCanonicalPluginNames(): Set<string> {
  if (_webPlugins != null) return _webPlugins;
  if (!existsSync(SERVER_RENDERER_PATH)) {
    throw new Error(
      `Cannot find server renderer at: ${SERVER_RENDERER_PATH}\n` +
        'If the file was moved, update SERVER_RENDERER_PATH in renderer-parity.spec.ts.',
    );
  }
  _webPlugins = extractImportedPluginNames(
    readFileSync(SERVER_RENDERER_PATH, 'utf-8'),
  );
  return _webPlugins;
}

/**
 * Unified pipeline infrastructure that the web renderer gets implicitly from
 * react-markdown rather than importing as named plugins. The bulk-export
 * pipeline builds these explicitly (it has no react-markdown), so they are
 * ADOPTED but have no corresponding import in the web renderer.
 */
const WEB_INFRASTRUCTURE_PLUGINS = new Set([
  'remark-parse', // implicit unified base
  'remark-rehype', // mdast→hast bridge
  'rehype-raw', // materialises raw HTML (paired with allowDangerousHtml)
  'rehype-stringify', // final serialiser
  'rehype-sanitize', // web renderer applies this via react-markdown options
]);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('RendererParityGuard — Web renderer plugin drift detection (AST)', () => {
  it('parses the renderer source into a non-empty plugin set (fails loudly if unreadable)', () => {
    const names = getWebCanonicalPluginNames();
    expect(names.size).toBeGreaterThan(0);
  });

  it('detects known web renderer plugins from generateCommonOptions + generateSSRViewOptions (sanity)', () => {
    const names = getWebCanonicalPluginNames();
    expect(names.has('remark-gfm')).toBe(true);
    expect(names.has('remark-frontmatter')).toBe(true);
    expect(names.has('remark-math')).toBe(true); // SSRViewOptions addition
    expect(names.has('rehype-slug')).toBe(true); // SSRViewOptions addition
    expect(names.has('rehype-katex')).toBe(true); // SSRViewOptions addition
  });

  /**
   * Core assertion 1 (Requirement 6.2):
   * Every plugin imported by the web renderer must be classified in plugin-set.ts
   * as ADOPTED or INTENTIONALLY_EXCLUDED. Failure = unclassified new plugin.
   */
  it('every web renderer plugin import is classified as adopted or intentionally excluded', () => {
    const webPlugins = getWebCanonicalPluginNames();

    const unclassified = [...webPlugins].filter(
      (name) =>
        !ADOPTED_PLUGIN_NAMES.has(name) && !EXCLUDED_PLUGIN_NAMES.has(name),
    );

    expect(
      unclassified,
      'The following web renderer plugins are not classified in plugin-set.ts:\n' +
        `  ${unclassified.join(', ')}\n` +
        'Add each to ADOPTED_PLUGINS or INTENTIONALLY_EXCLUDED_PLUGINS.',
    ).toHaveLength(0);
  });

  /**
   * Core assertion 2 (Requirement 6.1):
   * Every ADOPTED bulk-export plugin (minus pipeline infrastructure the web
   * renderer gets implicitly from react-markdown) must be imported by the web
   * renderer — i.e. bulk-export does not adopt plugins with no web counterpart.
   */
  it('every adopted bulk-export plugin corresponds to a web renderer plugin import', () => {
    const webPlugins = getWebCanonicalPluginNames();

    const orphanAdopted = [...ADOPTED_PLUGIN_NAMES].filter(
      (name) => !WEB_INFRASTRUCTURE_PLUGINS.has(name) && !webPlugins.has(name),
    );

    expect(
      orphanAdopted,
      'The following ADOPTED bulk-export plugins have no counterpart in the web renderer:\n' +
        `  ${orphanAdopted.join(', ')}\n` +
        'Either the web renderer should import them or they should be removed from ADOPTED_PLUGINS.',
    ).toHaveLength(0);
  });
});
