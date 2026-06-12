import path from 'node:path';
import { dynamicImport } from '@cspell/dynamic-import';
import type * as HastUtilSanitize from 'hast-util-sanitize';
import type { Plugin } from 'unified';

import { loadPlugins } from './esm-plugin-loader';
import { createBulkExportStyleProvider } from './styles';

/**
 * Bootstrap classes added to `<table>` elements, mirroring the GROWI web
 * renderer's generateCommonOptions (`addClass.rehypePlugin, { table: 'table table-bordered' }`).
 * The design system gives bare `<table>` no borders; `.table`/`.table-bordered`
 * (present in the precompiled CSS) supply them. We reuse the web add-class plugin
 * (below) rather than re-implementing class addition.
 */
const ADD_CLASS_ADDITIONS: Record<string, string> = {
  table: 'table table-bordered',
};

/**
 * Service contract for bulk-export Markdown → HTML conversion.
 *
 * Design: design.md § service / BulkExportMarkdownRenderer
 * Requirements: 1.1–1.6, 3.1, 4.1–4.3
 */
export interface BulkExportMarkdownRenderer {
  /**
   * The shared CSS to write once per job. Every rendered page links to this
   * stylesheet (see renderToHtml) instead of inlining it, so the CSS is not
   * duplicated across pages.
   */
  getCss(): string;
  /**
   * Convert one page's markdown body into a sanitized HTML document that links
   * the shared stylesheet at `cssHref` and wraps the content in a `.wiki`
   * container (design.md § BulkExportMarkdownRenderer).
   *
   * @param markdownBody - the page's raw markdown.
   * @param cssHref - href (relative to the page's HTML file) of the shared
   *   stylesheet written by the caller; emitted as `<link rel="stylesheet">`.
   */
  renderToHtml(markdownBody: string, cssHref: string): Promise<string>;
}

/**
 * Module-level processor cache — unified pipeline is built once and reused
 * across all pages in a bulk-export job (module-cache pattern).
 */
let cachedProcessor: Awaited<ReturnType<typeof buildProcessor>> | undefined;

/**
 * Build the sanitize schema by loading hast-util-sanitize and
 * services/renderer/recommended-whitelist.ts via dynamicImport so that the
 * bulk-export renderer shares a single source of truth with the web renderer.
 *
 * Design: design.md § Security Considerations — "許可リストの単一出所"
 *
 * @param baseDir - Resolution base for dynamicImport (caller's __dirname).
 */
async function buildSanitizeOptions(
  baseDir: string,
): Promise<HastUtilSanitize.Schema> {
  const { defaultSchema } = await dynamicImport<typeof HastUtilSanitize>(
    'hast-util-sanitize',
    baseDir,
  );

  // Single source of truth: load tagNames and attributes from the web
  // renderer's whitelist. dynamicImport (via import-meta-resolve + statSync)
  // requires the full path including extension for TypeScript source files.
  // ts-node handles the actual transpilation at import time.
  const whitelistPath = path.resolve(
    baseDir,
    '../../../../../../services/renderer/recommended-whitelist.ts',
  );
  const { tagNames, attributes } = await dynamicImport<{
    tagNames: string[];
    attributes: NonNullable<HastUtilSanitize.Schema['attributes']>;
  }>(whitelistPath, baseDir);

  return {
    ...defaultSchema,
    tagNames,
    attributes,
  };
}

/**
 * Load the GROWI web renderer's `add-class` rehype plugin via dynamicImport.
 *
 * `add-class.ts`'s only runtime dependency is `hast-util-select` (ESM, already a
 * production dependency); the rest are type-only. This is the same CJS→ESM reuse
 * pattern as the sanitize whitelist (buildSanitizeOptions), so we reuse the web
 * plugin rather than re-implementing class addition in bulk-export.
 *
 * @param baseDir - Resolution base for dynamicImport (caller's __dirname).
 */
async function loadAddClassPlugin(
  baseDir: string,
): Promise<Plugin<[unknown?]>> {
  const addClassPath = path.resolve(
    baseDir,
    '../../../../../../services/renderer/rehype-plugins/add-class.ts',
  );
  const { rehypePlugin } = await dynamicImport<{
    rehypePlugin: Plugin<[unknown?]>;
  }>(addClassPath, baseDir);
  return rehypePlugin;
}

/**
 * Build the unified processor by iterating the plugins declared in
 * plugin-set.ts (single source of truth) in order. No npm plugin is wired by
 * hand here: adding/removing one is a one-file change in plugin-set.ts.
 *
 * Two integrations are resolved at runtime via dynamicImport — reusing web code
 * rather than re-implementing it: rehype-sanitize's schema (buildSanitizeOptions)
 * and the web `add-class` plugin that gives <table> its Bootstrap classes.
 *
 * Design: design.md § System Flows
 */
async function buildProcessor(baseDir: string) {
  const { unified, plugins } = await loadPlugins(baseDir);
  const sanitizeOptions = await buildSanitizeOptions(baseDir);
  const addClass = await loadAddClassPlugin(baseDir);

  // unified().use() mutates the processor in place and returns `this`, so we
  // call it for its side effect on a single instance. (Reassigning would force
  // the variable's tree-type generics to change at each step.)
  const processor = unified();
  for (const { name, plugin, options } of plugins) {
    // Reuse the web renderer's add-class to give <table> the Bootstrap classes
    // (.table/.table-bordered) the design system relies on for borders. Applied
    // just before the serialiser — after rehype-sanitize, so the static, trusted
    // class values are not stripped.
    if (name === 'rehype-stringify') {
      processor.use(addClass, ADD_CLASS_ADDITIONS);
    }
    // rehype-sanitize's schema is resolved at runtime (single-source whitelist);
    // all other plugins use the static options declared in plugin-set.ts.
    const resolvedOptions: unknown =
      name === 'rehype-sanitize' ? sanitizeOptions : options;
    if (resolvedOptions != null) {
      processor.use(plugin, resolvedOptions);
    } else {
      processor.use(plugin);
    }
  }
  return processor;
}

/**
 * Factory for BulkExportMarkdownRenderer.
 *
 * The unified pipeline is built once on first call to renderToHtml and cached
 * at module level for reuse across all pages in a bulk-export job.
 *
 * @param baseDir - Resolution base for dynamicImport; pass __dirname from the
 *                  call site so that module resolution is anchored correctly.
 */
export function createBulkExportMarkdownRenderer(
  baseDir: string,
): BulkExportMarkdownRenderer {
  const styleProvider = createBulkExportStyleProvider();
  return {
    getCss(): string {
      return styleProvider.getCss();
    },
    async renderToHtml(markdownBody: string, cssHref: string): Promise<string> {
      if (cachedProcessor == null) {
        cachedProcessor = await buildProcessor(baseDir);
      }
      const htmlFragment = String(await cachedProcessor.process(markdownBody));
      return styleProvider.wrap(htmlFragment, cssHref);
    },
  };
}
