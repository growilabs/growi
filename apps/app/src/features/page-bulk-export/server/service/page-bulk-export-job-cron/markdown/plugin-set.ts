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
 *   → rehype plugins (raw, slug, sanitize, katex, stringify)
 */

/** A declared plugin entry: npm package name, pipeline position options. */
export interface PluginDeclaration {
  /** Exact npm package name (e.g. "remark-gfm"). */
  readonly name: string;
  /**
   * Options to pass when calling the plugin.
   * `undefined` means no options (default behaviour).
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
 *    codeblock, xsv-to-table, add-class, add-inline-code, relative-links):
 *    ERR_REQUIRE_ESM or React/DOM dependency; cannot be loaded in CJS server runtime.
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
  'add-class',
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
