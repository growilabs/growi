/**
 * BulkExportStyleProvider
 *
 * Supplies precompiled CSS (GROWI core-styles + .wiki scope + KaTeX) and wraps
 * a rendered HTML fragment in a `.wiki` container that links the shared
 * stylesheet via `<link rel="stylesheet">`.
 *
 * The stylesheet is written once per job by the export step (see
 * export-pages-to-fs-async) and every page links to it, so the ~MB of CSS
 * (Bootstrap base + KaTeX woff2 fonts inlined as data URIs) is NOT duplicated
 * into each page's HTML. pdf-converter loads the page via `file://` so the
 * relative `<link href>` resolves against the page's location on disk.
 *
 * Design constraints (design.md § BulkExportStyleProvider):
 *  - CSS comes from the precompiled BULK_EXPORT_CSS constant (build-time asset).
 *  - wrap() output format: `<link rel="stylesheet" href="…">\n<div class="wiki">{fragment}</div>`
 *  - No theme / layout / chrome CSS is injected (Req 2.3).
 *
 * Requirements: 2.1, 2.2, 2.3
 */
import { BULK_EXPORT_CSS } from './bulk-export.generated';

export interface BulkExportStyleProvider {
  /** Returns the CSS to write to the shared stylesheet (.wiki body styles + design-system base + KaTeX). */
  getCss(): string;
  /**
   * Wrap a rendered HTML fragment in a `.wiki` container that links the shared
   * stylesheet at `cssHref`.
   *
   * @param htmlFragment - the sanitized HTML fragment to wrap.
   * @param cssHref - href of the shared stylesheet, relative to the page's HTML file.
   */
  wrap(htmlFragment: string, cssHref: string): string;
}

/**
 * Factory for BulkExportStyleProvider.
 * The provider is stateless — create once and reuse across pages.
 */
export function createBulkExportStyleProvider(): BulkExportStyleProvider {
  return {
    getCss(): string {
      return BULK_EXPORT_CSS;
    },

    wrap(htmlFragment: string, cssHref: string): string {
      return `<link rel="stylesheet" href="${cssHref}">\n<div class="wiki">${htmlFragment}</div>`;
    },
  };
}
