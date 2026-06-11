import path from 'node:path';
import { dynamicImport } from '@cspell/dynamic-import';
import type * as HastUtilSanitize from 'hast-util-sanitize';
import type { Plugin } from 'unified';

import { loadPlugins } from './esm-plugin-loader';
import { createBulkExportStyleProvider } from './styles';

/**
 * Service contract for bulk-export Markdown → HTML conversion.
 *
 * Design: design.md § service / BulkExportMarkdownRenderer
 * Requirements: 1.1–1.6, 3.1, 4.1–4.3
 */
export interface BulkExportMarkdownRenderer {
  /**
   * Convert one page's markdown body into a sanitized, CSS-injected,
   * .wiki-wrapped, self-contained HTML string (design.md § BulkExportMarkdownRenderer).
   */
  renderToHtml(markdownBody: string): Promise<string>;
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
 * Build the unified processor with the full pipeline:
 *   remark-parse → remark-gfm + remark-frontmatter + remark-math
 *   → remark-rehype(allowDangerousHtml) → rehype-raw → rehype-slug
 *   → rehype-sanitize → rehype-katex → rehype-stringify
 *
 * Design: design.md § System Flows
 */
async function buildProcessor(baseDir: string) {
  const plugins = await loadPlugins(baseDir);
  const sanitizeOptions = await buildSanitizeOptions(baseDir);

  return plugins
    .unified()
    .use(plugins.remarkParse)
    .use(plugins.remarkGfm)
    .use(plugins.remarkFrontmatter)
    .use(plugins.remarkMath)
    .use(plugins.remarkRehype as Plugin<[unknown]>, {
      allowDangerousHtml: true,
    })
    .use(plugins.rehypeRaw)
    .use(plugins.rehypeSlug)
    .use(plugins.rehypeSanitize as Plugin<[unknown]>, sanitizeOptions)
    .use(plugins.rehypeKatex)
    .use(plugins.rehypeStringify);
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
    async renderToHtml(markdownBody: string): Promise<string> {
      if (cachedProcessor == null) {
        cachedProcessor = await buildProcessor(baseDir);
      }
      const htmlFragment = String(await cachedProcessor.process(markdownBody));
      return styleProvider.wrap(htmlFragment);
    },
  };
}
