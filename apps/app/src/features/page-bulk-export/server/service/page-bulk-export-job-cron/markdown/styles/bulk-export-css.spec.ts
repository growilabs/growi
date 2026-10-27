/**
 * Tests for the bulk-export pre-compiled CSS asset.
 *
 * Verifies that the generated CSS module contains the observable CSS rules
 * required for correct page rendering in PDF export:
 *  - .wiki scoped rules for table, blockquote, headings, code
 *  - Bootstrap --bs-* custom property definitions (:root)
 *  - @extend target classes: .link-offset-2, .link-underline-opacity-25, .link-underline-opacity-100-hover
 *  - KaTeX @font-face rules (with no external url() references remaining)
 *
 * Production-viability CI checks (Task 1.2):
 *  - The generated module has no npm import statements (no new runtime deps required)
 *  - No external font url() references remain in the CSS (all fonts inlined as data URIs)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

    // Inline code (no language-* class) gets a border + padding + radius on the web
    // via src/styles/atoms/_code.scss. The bulk-export CSS reuses that same file so
    // inline code in the PDF looks like the bordered pill it does in the browser.
    it('contains the inline-code border rule reused from atoms/_code.scss', () => {
      // selector: code:not([class^="language-"])
      expect(BULK_EXPORT_CSS).toMatch(
        /code:not\(\[class\^=['"]?language-['"]?\]\)/,
      );
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

    it('does not contain any external url() references to font files by extension (woff2, woff, ttf, eot, otf)', () => {
      // Comprehensive check: no url() pointing to an external font file by extension.
      // All fonts must be embedded as data URIs so that pdf-converter (Puppeteer) can
      // render the standalone HTML from /tmp without any external path resolution.
      // This is stronger than the fonts/ path check above: catches any external font
      // reference regardless of path prefix (bare filename, relative path, etc.).
      expect(BULK_EXPORT_CSS).not.toMatch(
        /url\(['"]?(?!data:)[^)'"]*\.(woff2?|ttf|eot|otf)['"]?\)/i,
      );
    });

    it('contains base64 data URI for KaTeX fonts', () => {
      expect(BULK_EXPORT_CSS).toMatch(/url\(data:font\//);
    });

    it('inlines only woff2 fonts (woff and ttf alternates are dropped to cut payload)', () => {
      // Chromium (Puppeteer) supports woff2, so the woff/ttf alternates are
      // stripped at build time — they accounted for ~2/3 of the font payload.
      // Observable: there must be woff2 data URIs and NO woff/ttf data URIs.
      expect(BULK_EXPORT_CSS).toMatch(/url\(data:font\/woff2;base64,/);
      expect(BULK_EXPORT_CSS).not.toMatch(/data:font\/(?:woff[^2]|ttf)/);
      // The dropped alternates' format() hints must not linger either.
      expect(BULK_EXPORT_CSS).not.toMatch(
        /format\(['"](?:woff|truetype)['"]\)/,
      );
    });
  });

  describe('production-viability: dependencies classification (Task 1.2)', () => {
    it('generated module source has no npm import statements — no new runtime deps required', () => {
      // The generated file must be a pure TypeScript constant module.
      // If it imported an npm package, that package would need to be in `dependencies`
      // (Turbopack externalisation rule). Asserting zero imports keeps the classification
      // stable: sass and @growi/core-styles remain devDependencies.
      const generatedSrc = readFileSync(
        resolve(__dirname, 'bulk-export.generated.ts'),
        'utf8',
      );
      // Match any `import` statement at the top level (static or type import)
      const importLines = generatedSrc.match(/^import\s+/m);
      expect(importLines).toBeNull();
    });

    it('generated module source starts with the expected auto-generated header comment', () => {
      // Verifies the file is actually the build output and not a hand-written stub.
      const generatedSrc = readFileSync(
        resolve(__dirname, 'bulk-export.generated.ts'),
        'utf8',
      );
      expect(generatedSrc).toMatch(
        /^\/\/ auto-generated by bin\/build-bulk-export-css\.ts/,
      );
    });
  });
});
