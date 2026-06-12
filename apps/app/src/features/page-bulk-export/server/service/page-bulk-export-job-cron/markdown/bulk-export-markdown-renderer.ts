import path from 'node:path';
import { dynamicImport } from '@cspell/dynamic-import';
import type * as HastUtilSanitize from 'hast-util-sanitize';

import { loadPlugins } from './esm-plugin-loader';
import { ADOPTED_PLUGINS } from './plugin-set';
import { createBulkExportStyleProvider } from './styles';

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
 * Build the unified processor by iterating the plugins declared in
 * plugin-set.ts (the single source of truth) in order. The pipeline — including
 * the reused web `add-class` plugin (loaded by relative path) — is fully data
 * driven; nothing is wired by hand here, so adding/removing/reordering a plugin
 * is a one-file change in plugin-set.ts.
 *
 * The one runtime-computed input is rehype-sanitize's schema (buildSanitizeOptions),
 * which the renderer supplies as that plugin's options.
 *
 * Design: design.md § System Flows
 */
async function buildProcessor(baseDir: string) {
  const { unified, plugins } = await loadPlugins(baseDir, ADOPTED_PLUGINS);
  const sanitizeOptions = await buildSanitizeOptions(baseDir);

  // unified().use() mutates the processor in place and returns `this`, so we
  // call it for its side effect on a single instance. (Reassigning would force
  // the variable's tree-type generics to change at each step.)
  const processor = unified();
  for (const { name, plugin, options } of plugins) {
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
