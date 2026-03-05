/**
 * Build-time script to extract Marp base CSS constants.
 *
 * Replicates the Marp configuration from growi-marpit.ts and generates
 * pre-extracted CSS so that GrowiSlides can apply Marp container styling
 * without a runtime dependency on @marp-team/marp-core or @marp-team/marpit.
 *
 * Regenerate with: node scripts/extract-marpit-css.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MarpOptions } from '@marp-team/marp-core';
import { Marp } from '@marp-team/marp-core';
import { Element } from '@marp-team/marpit';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MARP_CONTAINER_CLASS_NAME = 'marpit';

const marpitOption: MarpOptions = {
  container: [
    new Element('div', { class: `slides ${MARP_CONTAINER_CLASS_NAME}` }),
  ],
  inlineSVG: true,
  emoji: undefined,
  html: false,
  math: false,
};

// Slide mode: with shadow/rounded slide containers
const slideMarpitOption: MarpOptions = { ...marpitOption };
slideMarpitOption.slideContainer = [
  new Element('section', { class: 'shadow rounded m-2' }),
];
const slideMarpit = new Marp(slideMarpitOption);

// Presentation mode: minimal slide containers
const presentationMarpitOption: MarpOptions = { ...marpitOption };
presentationMarpitOption.slideContainer = [
  new Element('section', { class: 'm-2' }),
];
const presentationMarpit = new Marp(presentationMarpitOption);

const { css: slideCss } = slideMarpit.render('');
const { css: presentationCss } = presentationMarpit.render('');

if (!slideCss || !presentationCss) {
  // biome-ignore lint/suspicious/noConsole: Allows console output for script
  console.error('ERROR: CSS extraction produced empty output');
  process.exit(1);
}

const output = `// Generated file — do not edit manually
// Regenerate with: node scripts/extract-marpit-css.ts

export const SLIDE_MARPIT_CSS = ${JSON.stringify(slideCss)};

export const PRESENTATION_MARPIT_CSS = ${JSON.stringify(presentationCss)};
`;

const outPath = resolve(__dirname, '../src/client/consts/marpit-base-css.ts');
writeFileSync(outPath, output, 'utf-8');

// biome-ignore lint/suspicious/noConsole: Allows console output for script
console.log(`Extracted Marp base CSS to ${outPath}`);
