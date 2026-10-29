#!/usr/bin/env node
/** biome-ignore-all lint/suspicious/noConsole: script output */
/**
 * Extracts a minimal emoji native lookup from @emoji-mart/data.
 *
 * Emojis are ordered by category so that CodeMirror autocomplete suggests
 * common emojis (people, nature, …) before flags and symbols.
 *
 * Run via the package build script (from the monorepo root):
 *   turbo run build --filter @growi/emoji-mart-data
 *
 * Or directly (from packages/emoji-mart-data/):
 *   node bin/extract.ts
 *
 * Skin-tone-capable emojis carry 6 skins (default + skin-tone-2..6); `aliases`
 * maps alias -> canonical id.
 *
 * Output: dist/index.js, dist/index.d.ts
 * Re-run whenever @emoji-mart/data is upgraded.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildAliases, buildLookup, type EmojiData } from './build-lookup.ts';

const inputPath = resolve(
  import.meta.dirname,
  '../node_modules/@emoji-mart/data/sets/15/native.json',
);

const raw: EmojiData = JSON.parse(readFileSync(inputPath, 'utf8'));

const lookup = buildLookup(raw);
const aliases = buildAliases(raw, lookup);

const distDir = resolve(import.meta.dirname, '../dist');
mkdirSync(distDir, { recursive: true });

// Emit as an ES module so TypeScript resolves index.d.ts for types
// instead of inferring a 1870-key literal type from the raw JSON.
const jsPath = resolve(distDir, 'index.js');
writeFileSync(
  jsPath,
  `// Generated — do not edit. Run \`node bin/extract.ts\` to regenerate.\nexport default ${JSON.stringify(lookup)};\nexport const aliases = ${JSON.stringify(aliases)};\n`,
  'utf8',
);
console.log(`Wrote ${Object.keys(lookup).length} entries to ${jsPath}`);

const dtsPath = resolve(distDir, 'index.d.ts');
writeFileSync(
  dtsPath,
  [
    'export type NativeLookup = Record<',
    '  string,',
    '  { skins: readonly [{ native: string }, ...{ native: string }[]] }',
    '>;',
    'declare const _default: NativeLookup;',
    'export default _default;',
    'export declare const aliases: Readonly<Record<string, string>>;',
    '',
  ].join('\n'),
  'utf8',
);
console.log(`Wrote ${dtsPath}`);
