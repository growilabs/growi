/**
 * Tests for BulkExportStyleProvider.
 *
 * Observable contract:
 *  - getCss() returns the precompiled CSS string (non-empty, == BULK_EXPORT_CSS)
 *  - wrap(html, cssHref) links the shared stylesheet via <link rel="stylesheet">
 *    and wraps the fragment in <div class="wiki">…</div>
 *  - The CSS is NOT inlined into the wrapped output (it lives in the shared file)
 *  - The original html fragment is preserved inside the .wiki div
 *
 * Requirements covered: 2.1, 2.2, 2.3
 */
import { describe, expect, it } from 'vitest';

import { BULK_EXPORT_CSS } from './bulk-export.generated';
import { createBulkExportStyleProvider } from './bulk-export-styles';

describe('BulkExportStyleProvider', () => {
  const provider = createBulkExportStyleProvider();
  const CSS_HREF = '../_bulk-export.css';

  describe('getCss()', () => {
    it('returns a non-empty string', () => {
      const css = provider.getCss();
      expect(typeof css).toBe('string');
      expect(css.length).toBeGreaterThan(0);
    });

    it('returns the precompiled BULK_EXPORT_CSS constant (Req 2.2: design-system styles)', () => {
      expect(provider.getCss()).toBe(BULK_EXPORT_CSS);
    });
  });

  describe('wrap()', () => {
    it('links the shared stylesheet at the given href (Req 2.1: styles applied)', () => {
      const result = provider.wrap('<p>Hello</p>', CSS_HREF);
      expect(result).toContain(`<link rel="stylesheet" href="${CSS_HREF}">`);
    });

    it('does NOT inline the CSS into the wrapped output (no per-page duplication)', () => {
      const result = provider.wrap('<p>Hello</p>', CSS_HREF);
      expect(result).not.toContain('<style>');
      // The full ~MB stylesheet must not be embedded in each page.
      expect(result).not.toContain(BULK_EXPORT_CSS);
    });

    it('output contains <div class="wiki"> wrapper (Req 2.1: .wiki container)', () => {
      const result = provider.wrap('<p>Hello</p>', CSS_HREF);
      expect(result).toContain('<div class="wiki">');
    });

    it('output contains closing </div> for the .wiki wrapper', () => {
      const result = provider.wrap('<p>Hello</p>', CSS_HREF);
      expect(result).toContain('</div>');
    });

    it('preserves the html fragment inside the .wiki div', () => {
      const fragment = '<p>Hello</p>';
      const result = provider.wrap(fragment, CSS_HREF);
      expect(result).toContain(fragment);
    });

    it('the fragment appears after the <link> tag', () => {
      const fragment = '<p>content</p>';
      const result = provider.wrap(fragment, CSS_HREF);
      const linkEnd = result.indexOf('>');
      const fragmentPos = result.indexOf(fragment);
      expect(linkEnd).toBeGreaterThanOrEqual(0);
      expect(fragmentPos).toBeGreaterThan(linkEnd);
    });

    it('format: <link …>\\n<div class="wiki">…</div>', () => {
      const fragment = '<p>test</p>';
      const result = provider.wrap(fragment, CSS_HREF);
      expect(result).toBe(
        `<link rel="stylesheet" href="${CSS_HREF}">\n<div class="wiki">${fragment}</div>`,
      );
    });

    it('edge case: wrap("") still produces correct structure', () => {
      const result = provider.wrap('', CSS_HREF);
      expect(result).toContain('<link rel="stylesheet"');
      expect(result).toContain('<div class="wiki">');
      expect(result).toContain('</div>');
    });

    it('reflects the href verbatim for differently-nested pages (Req 2.1)', () => {
      expect(provider.wrap('<p/>', '_bulk-export.css')).toContain(
        'href="_bulk-export.css"',
      );
      expect(provider.wrap('<p/>', '../../_bulk-export.css')).toContain(
        'href="../../_bulk-export.css"',
      );
    });
  });
});
