import { renderMarkdownToHtml } from '~/server/service/markdown-pipeline';

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
 * Factory for BulkExportMarkdownRenderer.
 *
 * The shared markdown pipeline builds its processor once and reuses it across
 * all pages in a bulk-export job.
 */
export function createBulkExportMarkdownRenderer(): BulkExportMarkdownRenderer {
  const styleProvider = createBulkExportStyleProvider();
  return {
    getCss(): string {
      return styleProvider.getCss();
    },
    async renderToHtml(markdownBody: string, cssHref: string): Promise<string> {
      const htmlFragment = await renderMarkdownToHtml(markdownBody);
      return styleProvider.wrap(htmlFragment, cssHref);
    },
  };
}
