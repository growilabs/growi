/**
 * Build script: compile a self-contained CSS asset for bulk-export PDF rendering.
 *
 * Outputs a TypeScript module at:
 *   src/features/page-bulk-export/server/service/page-bulk-export-job-cron/markdown/styles/bulk-export.generated.ts
 *
 * The module exports a single `BULK_EXPORT_CSS` constant containing:
 *   1. Bootstrap base styles (:root { --bs-* }, utilities, components) from @growi/core-styles
 *   2. .wiki scoped content styles from apps/app/src/styles/organisms/_wiki.scss
 *   3. KaTeX CSS with all font url() references replaced by base64 data URIs
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import * as sass from 'sass';

// ─── Paths ───────────────────────────────────────────────────────────────────

const APPS_APP_DIR = resolve(__dirname, '..');
const NODE_MODULES_DIR = resolve(APPS_APP_DIR, 'node_modules');
const KATEX_CSS_PATH = resolve(NODE_MODULES_DIR, 'katex/dist/katex.css');
const KATEX_FONTS_DIR = resolve(NODE_MODULES_DIR, 'katex/dist/fonts');
const APP_STYLES_DIR = resolve(APPS_APP_DIR, 'src/styles');
// Added to loadPaths so that `@use 'styles/...'` specifiers (used by the app's own
// SCSS, e.g. atoms/_code.scss → `@use 'styles/variables'`) resolve against src/.
const APP_SRC_DIR = resolve(APPS_APP_DIR, 'src');
const OUTPUT_DIR = resolve(
  APPS_APP_DIR,
  'src/features/page-bulk-export/server/service/page-bulk-export-job-cron/markdown/styles',
);
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'bulk-export.generated.ts');

// ─── Step 1: Write a temporary SCSS entry file and compile it ────────────────
//
// The temporary file is placed in src/styles/organisms/ so that:
//  - @use '../variables' inside _wiki.scss resolves to src/styles/_variables.scss
//  - @use 'wiki' resolves to _wiki.scss in the same directory
//
// @growi/core-styles and bootstrap are resolved via node_modules loadPath.

const TEMP_SCSS_PATH = resolve(
  APP_STYLES_DIR,
  'organisms/_bulk-export-entry-temp.scss',
);

const SCSS_ENTRY_CONTENT = `
// Self-contained SCSS entry for bulk export PDF rendering.
// This temporary file is placed next to _wiki.scss so that wiki's relative
// @use '../variables' resolves correctly.

// 1. Bootstrap full output — :root { --bs-* }, utility classes, components
@use '@growi/core-styles/scss/bootstrap/apply';

// 2. .wiki scoped content styles
@use 'wiki' as wiki-content;

// 3. Inline-code border/padding/radius (reused from the app's own atoms/_code.scss,
//    the single source for the bordered inline-code "pill" the web renderer shows).
@use 'styles/atoms/code';
`;

// biome-ignore lint/suspicious/noConsole: build script — console output is expected
console.log('Writing temporary SCSS entry...');
writeFileSync(TEMP_SCSS_PATH, SCSS_ENTRY_CONTENT, 'utf-8');

let compiledCss: string;
try {
  // biome-ignore lint/suspicious/noConsole: build script — console output is expected
  console.log('Compiling SCSS...');

  const sassResult = sass.compile(TEMP_SCSS_PATH, {
    // loadPaths allows Sass to resolve bare module specifiers (@growi/core-styles, bootstrap)
    // via apps/app/node_modules where @growi/core-styles is symlinked to packages/core-styles.
    // APP_SRC_DIR lets `@use 'styles/...'` specifiers (atoms/code and its `styles/variables`
    // dependency) resolve against src/.
    loadPaths: [NODE_MODULES_DIR, APP_SRC_DIR],
    quietDeps: true,
  });

  compiledCss = sassResult.css;
  // biome-ignore lint/suspicious/noConsole: build script — console output is expected
  console.log(`SCSS compiled: ${compiledCss.length} chars`);
} finally {
  // Always clean up the temporary SCSS entry file
  if (existsSync(TEMP_SCSS_PATH)) {
    unlinkSync(TEMP_SCSS_PATH);
  }
}

// ─── Step 2: Process KaTeX CSS with font inlining (woff2 only) ────────────────
//
// KaTeX ships each face in three formats (woff2, woff, ttf). Chromium (the
// engine pdf-converter drives via Puppeteer) supports woff2, so we keep only
// woff2 and drop the woff/ttf alternates. Since the fonts are base64-inlined
// into the CSS, dropping two of three formats removes ~2/3 of the font payload
// (woff ≈ 395 KB + ttf ≈ 669 KB out of ~1.43 MB).

// biome-ignore lint/suspicious/noConsole: build script — console output is expected
console.log('Processing KaTeX CSS and inlining woff2 fonts...');

let katexCss = readFileSync(KATEX_CSS_PATH, 'utf-8');

// 1) Strip the woff/ttf alternates (and their leading comma separator) from each
//    @font-face `src`, leaving only the woff2 source. KaTeX always lists woff2
//    first, so the woff/ttf entries always carry the preceding comma.
katexCss = katexCss.replace(
  /,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\(['"][^'")]+['"]\)/g,
  '',
);

// 2) Inline the remaining woff2 url(fonts/<name>.woff2) as base64 data URIs so
//    pdf-converter can render standalone HTML without external path resolution.
katexCss = katexCss.replace(
  /url\(fonts\/([^)]+)\)/g,
  (_match: string, fontFile: string) => {
    const fontPath = join(KATEX_FONTS_DIR, fontFile);
    if (!existsSync(fontPath)) {
      // biome-ignore lint/suspicious/noConsole: build script — console output is expected
      console.warn(`  Warning: font not found: ${fontPath}`);
      return `url(fonts/${fontFile})`;
    }
    const fontData = readFileSync(fontPath);
    const base64 = fontData.toString('base64');
    return `url(data:font/woff2;base64,${base64})`;
  },
);

// biome-ignore lint/suspicious/noConsole: build script — console output is expected
console.log(`KaTeX CSS processed: ${katexCss.length} chars`);

// ─── Step 3: Combine and write output ────────────────────────────────────────

const fullCss = `${compiledCss}\n/* KaTeX styles */\n${katexCss}`;

// biome-ignore lint/suspicious/noConsole: build script — console output is expected
console.log(`Total CSS: ${fullCss.length} chars`);

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const outputContent = `// auto-generated by bin/build-bulk-export-css.ts — do not edit manually
// Run: pnpm run pre:styles-bulk-export
export const BULK_EXPORT_CSS = ${JSON.stringify(fullCss)};
`;

writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');
// biome-ignore lint/suspicious/noConsole: build script — console output is expected
console.log(`Written: ${OUTPUT_FILE}`);
