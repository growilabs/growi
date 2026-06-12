/**
 * Canonical declaration of adopted and intentionally-excluded plugins for the
 * bulk-export Markdown → HTML pipeline.
 *
 * This module is the single source of truth used by:
 *  - EsmPluginLoader (task 3.x) — which plugins to dynamicImport and in what order
 *  - RendererParityGuard (task 6.1) — drift test comparing this set against
 *    generateCommonOptions / generateSSRViewOptions from the web renderer
 *
 * Ordering follows the unified pipeline (mirrors the web renderer's selection order):
 *   remark-parse (implicit base)
 *   → remark plugins (gfm, emoji, remark-directive, echo-directive, frontmatter,
 *                      math, xsv-to-table)
 *   → remark-rehype (bridge, allowDangerousHtml)
 *   → rehype plugins (raw, slug, sanitize, katex, add-class, stringify)
 *
 * Entries are loaded by EsmPluginLoader generically: npm plugins by bare
 * specifier, reused local plugins (emoji, echo-directive, xsv-to-table, add-class)
 * by relative path + named export.
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
  // Reused GROWI web plugin: emoji converts `:smile:` shortcodes to native emoji
  // glyphs (req 1.7). Placed right after gfm and BEFORE remark-directive so that
  // `:smile:` is consumed as an emoji, not parsed as a text directive (mirrors the
  // web renderer order). React/DOM-free mdast transform; loaded by relative path.
  {
    name: 'emoji',
    specifier: '../../../../../../services/renderer/remark-plugins/emoji.ts',
    exportName: 'remarkPlugin',
    options: undefined,
  },
  // remark-directive parses `:foo[..]{..}` / `::bar` / `:::baz` directive syntax
  // into directive nodes. Required for echo-directive (next) to find them. npm ESM.
  { name: 'remark-directive', options: undefined },
  // Reused GROWI web plugin: echo-directive degrades text/leaf directives to readable
  // text (`<span>`/`<div>` showing the directive name), without leaking the `{...}`
  // attribute syntax (req 3.1a). Container directives are callout's domain (not adopted)
  // and degrade to a plain text-preserving block. React/DOM-free; loaded by relative path.
  {
    name: 'echo-directive',
    specifier:
      '../../../../../../services/renderer/remark-plugins/echo-directive.ts',
    exportName: 'remarkPlugin',
    options: undefined,
  },
  { name: 'remark-frontmatter', options: undefined },
  { name: 'remark-math', options: undefined },
  // Reused GROWI web plugin: xsv-to-table converts csv/csv-h/tsv/tsv-h fenced code
  // blocks to GFM tables (req 1.8). Placed after math (mirrors the web view order
  // `push(math, xsvToTable)`) and before remark-rehype so the produced <table> later
  // receives `table table-bordered` from add-class. React/DOM-free; loaded by relative path.
  {
    name: 'xsv-to-table',
    specifier:
      '../../../../../../services/renderer/remark-plugins/xsv-to-table.ts',
    exportName: 'remarkPlugin',
    options: undefined,
  },
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
 * generateSSRViewOptions) that this pipeline consciously omits. NOTE (改訂 5):
 * exclusion is NOT because "local .ts plugins can't be loaded" — that earlier claim
 * (research.md I2) was disproven by add-class and corrected; any React/DOM-free AST
 * transform loads fine via the same relative-path dynamicImport pattern. The real
 * reasons, by group:
 *  - Degrades WORSE without callout (research.md I7):
 *      github-admonitions — converts `> [!NOTE]` to a `:::note` container directive,
 *      which (with no callout to render it) becomes an anonymous <div> that LOSES the
 *      alert label. Leaving GitHub alerts as blockquotes (label visible as text) is the
 *      better degradation, so this plugin is not adopted.
 *  - React-component / browser-DOM driven; faithful rendering needs React SSR or a
 *    browser, out of scope for this phase (Phase 2 / renderer-convergence):
 *      callout (colored callouts via CalloutViewer), and the diagram/highlight features
 *      (drawio, lsx, mermaid, plantuml, attachment-refs, syntax-highlight colors).
 *  - Not needed by this spec / deferred for a different reason:
 *      pukiwiki-like-linker, growi-directive (parser alone is not useful without its
 *      React consumers), codeblock / add-inline-code (negligible visual effect),
 *      relative-links (needs a per-page pagePath injected at runtime),
 *      remark-breaks (gated on the per-instance `isEnabledLinebreaks` config).
 *
 * (emoji, xsv-to-table, remark-directive and echo-directive were excluded here before
 * 改訂 5; they are now ADOPTED — see ADOPTED_PLUGINS above.)
 */
export const INTENTIONALLY_EXCLUDED_PLUGINS: ReadonlyArray<string> = [
  'pukiwiki-like-linker',
  'growi-directive',
  'codeblock',
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
