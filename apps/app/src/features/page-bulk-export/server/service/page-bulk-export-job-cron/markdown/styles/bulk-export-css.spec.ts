/**
 * Tests for the bulk-export pre-compiled CSS asset.
 *
 * Verifies that the generated CSS module contains the observable CSS rules
 * required for correct page rendering in PDF export:
 *  - .wiki scoped rules for table, blockquote, headings, code
 *  - Bootstrap --bs-* custom property definitions (:root)
 *  - @extend target classes: .link-offset-2, .link-underline-opacity-25, .link-underline-opacity-100-hover
 *  - KaTeX @font-face rules (with no external url() references remaining)
 */
import { describe, expect, it } from 'vitest';

import { BULK_EXPORT_CSS } from './bulk-export.generated';

describe('BULK_EXPORT_CSS', () => {
  it('exports a non-empty CSS string', () => {
    expect(typeof BULK_EXPORT_CSS).toBe('string');
    expect(BULK_EXPORT_CSS.length).toBeGreaterThan(0);
  });

  describe('.wiki scoped rules', () => {
    it('contains .wiki table rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+table/);
    });

    it('contains .wiki blockquote rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+blockquote/);
    });

    it('contains .wiki h1 rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+h1/);
    });

    it('contains .wiki h2 rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+h2/);
    });

    it('contains .wiki h3 rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+h3/);
    });

    it('contains .wiki h4 rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+h4/);
    });

    it('contains .wiki h5 rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+h5/);
    });

    it('contains .wiki h6 rule', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.wiki\s+h6/);
    });

    it('contains code element rule (global or wiki-scoped)', () => {
      // Bootstrap provides global `code` and `pre code` selectors.
      // _wiki.scss relies on Bootstrap reboot for code element styling
      // rather than adding a .wiki-scoped selector. Verify Bootstrap
      // code rules are present in the output.
      expect(BULK_EXPORT_CSS).toMatch(/\bcode\s*[,{]/);
    });
  });

  describe('Bootstrap CSS custom properties', () => {
    it('contains :root with --bs-* custom property definitions', () => {
      expect(BULK_EXPORT_CSS).toMatch(/:root\s*\{[^}]*--bs-/);
    });

    it('contains --bs-border-color custom property', () => {
      expect(BULK_EXPORT_CSS).toMatch(/--bs-border-color\s*:/);
    });

    it('contains --bs-link-color-rgb custom property', () => {
      expect(BULK_EXPORT_CSS).toMatch(/--bs-link-color-rgb\s*:/);
    });
  });

  describe('@extend target classes', () => {
    it('contains .link-offset-2 class definition', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.link-offset-2[\s,{]/);
    });

    it('contains .link-underline-opacity-25 class definition', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.link-underline-opacity-25[\s,{]/);
    });

    it('contains .link-underline-opacity-100-hover class definition', () => {
      // Bootstrap generates hover-prefixed variants
      expect(BULK_EXPORT_CSS).toMatch(/link-underline-opacity-100/);
    });
  });

  describe('KaTeX rules', () => {
    it('contains KaTeX @font-face rules', () => {
      expect(BULK_EXPORT_CSS).toMatch(/@font-face/);
    });

    it('contains KaTeX font family references', () => {
      expect(BULK_EXPORT_CSS).toMatch(/KaTeX_/);
    });

    it('contains KaTeX utility class .katex', () => {
      expect(BULK_EXPORT_CSS).toMatch(/\.katex/);
    });

    it('does not contain external url() font references (fonts must be inlined as data URIs)', () => {
      // Any remaining url() must be a data: URI, not a relative fonts/ path
      const fontUrlMatches = BULK_EXPORT_CSS.match(/url\([^)]+\)/g) ?? [];
      const externalFontUrls = fontUrlMatches.filter(
        (u) => u.includes('fonts/') && !u.startsWith('url(data:'),
      );
      expect(externalFontUrls).toHaveLength(0);
    });

    it('contains base64 data URI for KaTeX fonts', () => {
      expect(BULK_EXPORT_CSS).toMatch(/url\(data:font\//);
    });
  });
});
