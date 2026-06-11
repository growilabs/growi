/**
 * BulkExportStyleProvider
 *
 * Supplies precompiled CSS (GROWI core-styles + .wiki scope + KaTeX) and wraps
 * a rendered HTML fragment with a <style> injection and a `.wiki` container,
 * so that pdf-converter (Puppeteer) receives a self-contained HTML document.
 *
 * Design constraints (design.md § BulkExportStyleProvider):
 *  - CSS comes from the precompiled BULK_EXPORT_CSS constant (build-time asset).
 *  - wrap() output format: `<style>…</style>\n<div class="wiki">{fragment}</div>`
 *  - No theme / layout / chrome CSS is injected (Req 2.3).
 *
 * Requirements: 2.1, 2.2, 2.3
 */
import { BULK_EXPORT_CSS } from './bulk-export.generated';

export interface BulkExportStyleProvider {
  /** Returns the CSS to inject (.wiki body styles + design-system base + KaTeX). */
  getCss(): string;
  /** Wrap a rendered HTML fragment with the injected <style> and a .wiki container. */
  wrap(htmlFragment: string): string;
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

    wrap(htmlFragment: string): string {
      const css = BULK_EXPORT_CSS;
      return `<style>${css}</style>\n<div class="wiki">${htmlFragment}</div>`;
    },
  };
}
