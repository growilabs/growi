/**
 * Canonical declaration of adopted and intentionally-excluded plugins for the
 * bulk-export Markdown → HTML pipeline.
 *
 * This module is the single source of truth used by:
 *  - EsmPluginLoader (task 3.x) — which plugins to dynamicImport and in what order
 *  - RendererParityGuard (task 6.1) — drift test comparing this set against
 *    generateCommonOptions / generateSSRViewOptions from the web renderer
 *
 * Ordering follows the unified pipeline:
 *   remark-parse (implicit base)
 *   → remark plugins (gfm, frontmatter, math)
 *   → remark-rehype (bridge, allowDangerousHtml)
 *   → rehype plugins (raw, slug, sanitize, katex, add-class, stringify)
 *
 * Entries are loaded by EsmPluginLoader generically: npm plugins by bare
 * specifier, reused local plugins (add-class) by relative path + named export.
 */

/** A declared plugin entry: how to load it, its pipeline options, and its
 *  canonical name (for the web-renderer parity test). */
export interface PluginDeclaration {
  /**
   * Canonical name — the npm package name for npm plugins (also used as the
   * import specifier), or the short name the web renderer / parity test use for
   * a reused local plugin (e.g. "add-class").
   */
  readonly name: string;
  /**
   * Module to import when it differs from `name` — e.g. a relative path (from
   * the markdown/ dir) to a reused local GROWI plugin. Defaults to `name`,
   * treated as a bare npm specifier.
   */
  readonly specifier?: string;
  /** Named export to use as the plugin. Defaults to "default". */
  readonly exportName?: string;
  /**
   * Options to pass when calling the plugin. `undefined` means no options.
   * (rehype-sanitize's schema is computed at runtime and supplied by the renderer.)
   */
  readonly options?: Record<string, unknown>;
}

/**
 * Adopted plugins in pipeline execution order.
 *
 * Design reference: design.md § Technology Stack
 *   remark-parse, remark-gfm, remark-frontmatter, remark-math,
 *   remark-rehype (allowDangerousHtml), rehype-raw, rehype-slug,
 *   rehype-sanitize, rehype-katex, rehype-stringify
 *
 * Note: remark-parse is the implicit unified base processor entry point;
 * it is listed first for completeness and traceability but is not dynamicImport-ed
 * as a separate plugin (it is part of unified itself via remark()).
 */
export const ADOPTED_PLUGINS: ReadonlyArray<PluginDeclaration> = [
  { name: 'remark-parse', options: undefined },
  { name: 'remark-gfm', options: undefined },
  { name: 'remark-frontmatter', options: undefined },
  { name: 'remark-math', options: undefined },
  // Bridge: converts mdast → hast; allowDangerousHtml preserves raw HTML nodes
  // for subsequent rehype-raw processing (which is always followed by rehype-sanitize)
  { name: 'remark-rehype', options: { allowDangerousHtml: true } },
  // rehype-raw materialises raw HTML nodes into the hast tree; must precede sanitize
  { name: 'rehype-raw', options: undefined },
  // Assigns id attributes to headings for anchor linking (req 1.4)
  { name: 'rehype-slug', options: undefined },
  // Sanitize must run after rehype-raw and before rehype-katex (katex output is trusted)
  { name: 'rehype-sanitize', options: undefined },
  // rehype-katex renders math nodes; placed after sanitize so its trusted output is not stripped
  { name: 'rehype-katex', options: undefined },
  // Reused GROWI web plugin: add-class adds `table table-bordered` so the design
  // system's .table/.table-bordered borders apply (mirrors generateCommonOptions).
  // Loaded via dynamicImport from a relative path; its only runtime dependency
  // (hast-util-select) is ESM. Placed after sanitize (trusted, static class
  // values), before stringify.
  {
    name: 'add-class',
    specifier:
      '../../../../../../services/renderer/rehype-plugins/add-class.ts',
    exportName: 'rehypePlugin',
    options: { table: 'table table-bordered' },
  },
  // Serialises the hast tree to an HTML string; must be last
  { name: 'rehype-stringify', options: undefined },
] as const;

/**
 * Plugins intentionally excluded from the bulk-export pipeline.
 *
 * These are plugins present in the GROWI web renderer (generateCommonOptions /
 * generateSSRViewOptions) that this pipeline consciously omits. The exclusion
 * reasons are documented in research.md:
 *  - Local .ts plugins (emoji, pukiwiki-like-linker, growi-directive, echo-directive,
 *    codeblock, xsv-to-table, add-inline-code, relative-links):
 *    ERR_REQUIRE_ESM or React/DOM dependency; cannot be loaded in CJS server runtime.
 *    (add-class is the exception: it depends only on hast-util-select (ESM), so it
 *    IS reused — see its entry in ADOPTED_PLUGINS above, loaded by relative path.)
 *  - React-component-driven features (callout, github-admonitions):
 *    Faithful rendering requires React SSR; out of scope for this spec phase.
 *  - remark-directive: GROWI directive syntax support depends on local .ts plugins
 *    listed above; including the parser alone is not useful.
 *  - remark-breaks: conditionally used in the web renderer only when
 *    `config.isEnabledLinebreaks` is true (a per-instance GROWI setting). The
 *    bulk-export pipeline does not have access to this runtime config in the
 *    current scope; per-page rendering fidelity for this setting is out of scope.
 */
export const INTENTIONALLY_EXCLUDED_PLUGINS: ReadonlyArray<string> = [
  'emoji',
  'pukiwiki-like-linker',
  'growi-directive',
  'remark-directive',
  'echo-directive',
  'codeblock',
  'xsv-to-table',
  'github-admonitions',
  'callout',
  'add-inline-code',
  'relative-links',
  'remark-breaks',
] as const;

/**
 * Machine-readable Set of adopted plugin names.
 * Used by the drift test (task 6.1) to classify each web-renderer plugin as
 * included or intentionally-excluded.
 */
export const ADOPTED_PLUGIN_NAMES: ReadonlySet<string> = new Set(
  ADOPTED_PLUGINS.map((p) => p.name),
);

/**
 * Machine-readable Set of intentionally-excluded plugin names.
 * Used by the drift test (task 6.1) to verify full coverage of the web renderer's
 * plugin set: every web plugin must appear in either ADOPTED_PLUGIN_NAMES or
 * EXCLUDED_PLUGIN_NAMES.
 */
export const EXCLUDED_PLUGIN_NAMES: ReadonlySet<string> = new Set(
  INTENTIONALLY_EXCLUDED_PLUGINS,
);
