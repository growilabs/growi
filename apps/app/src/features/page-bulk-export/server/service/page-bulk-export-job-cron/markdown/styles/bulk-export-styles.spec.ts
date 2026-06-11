/**
 * Tests for BulkExportStyleProvider (Task 4.1).
 *
 * Observable contract:
 *  - getCss() returns the precompiled CSS string (non-empty, same as BULK_EXPORT_CSS)
 *  - wrap(html) returns a string containing <style>…</style>\n<div class="wiki">…</div>
 *  - The CSS inside <style> is non-empty
 *  - The original html fragment is preserved inside the .wiki div
 *  - Edge case: wrap('') still produces the correct structure
 *
 * Requirements covered: 2.1, 2.2, 2.3
 */
import { describe, expect, it } from 'vitest';

import { BULK_EXPORT_CSS } from './bulk-export.generated';
import { createBulkExportStyleProvider } from './bulk-export-styles';

describe('BulkExportStyleProvider', () => {
  const provider = createBulkExportStyleProvider();

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
    it('output contains a <style> tag (Req 2.1: styles injected)', () => {
      const result = provider.wrap('<p>Hello</p>');
      expect(result).toMatch(/<style>/);
    });

    it('output contains a closing </style> tag', () => {
      const result = provider.wrap('<p>Hello</p>');
      expect(result).toMatch(/<\/style>/);
    });

    it('output contains <div class="wiki"> wrapper (Req 2.1: .wiki container)', () => {
      const result = provider.wrap('<p>Hello</p>');
      expect(result).toContain('<div class="wiki">');
    });

    it('output contains closing </div> for the .wiki wrapper', () => {
      const result = provider.wrap('<p>Hello</p>');
      expect(result).toContain('</div>');
    });

    it('the CSS inside <style> is non-empty (Req 2.2: design-system CSS present)', () => {
      const result = provider.wrap('<p>Hello</p>');
      // Extract content between <style> and </style>
      const match = result.match(/<style>([\s\S]*?)<\/style>/);
      expect(match).not.toBeNull();
      const cssContent = match![1];
      expect(cssContent.trim().length).toBeGreaterThan(0);
    });

    it('the CSS inside <style> is the BULK_EXPORT_CSS content (Req 2.2)', () => {
      const result = provider.wrap('<p>Hello</p>');
      expect(result).toContain(BULK_EXPORT_CSS);
    });

    it('preserves the html fragment inside the .wiki div', () => {
      const fragment = '<p>Hello</p>';
      const result = provider.wrap(fragment);
      expect(result).toContain(fragment);
    });

    it('the fragment appears inside the .wiki div (after the closing </style>)', () => {
      const fragment = '<p>content</p>';
      const result = provider.wrap(fragment);
      const styleEnd = result.indexOf('</style>');
      const fragmentPos = result.indexOf(fragment);
      expect(styleEnd).toBeGreaterThanOrEqual(0);
      expect(fragmentPos).toBeGreaterThan(styleEnd);
    });

    it('format: <style>…</style>\\n<div class="wiki">…</div>', () => {
      const fragment = '<p>test</p>';
      const result = provider.wrap(fragment);
      // The style block ends, then a newline, then the wiki div starts
      expect(result).toContain(`</style>\n<div class="wiki">`);
    });

    it('edge case: wrap("") still produces correct structure', () => {
      const result = provider.wrap('');
      expect(result).toContain('<style>');
      expect(result).toContain('</style>');
      expect(result).toContain('<div class="wiki">');
      expect(result).toContain('</div>');
    });

    it('does not include theme/layout/chrome styles — only body content CSS (Req 2.3)', () => {
      // Observable: the CSS comes only from the precompiled asset, no additional chrome injected
      const result = provider.wrap('<p>test</p>');
      const match = result.match(/<style>([\s\S]*?)<\/style>/);
      const cssContent = match![1];
      // The CSS in the style tag should be exactly BULK_EXPORT_CSS (no extra chrome added)
      expect(cssContent).toBe(BULK_EXPORT_CSS);
    });
  });
});
