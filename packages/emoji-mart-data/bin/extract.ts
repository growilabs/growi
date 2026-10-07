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
 * Output: dist/index.js, dist/index.d.ts
 * Re-run whenever @emoji-mart/data is upgraded.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type EmojiEntry = { skins: { native: string }[] };

type EmojiData = {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, EmojiEntry>;
};

type NativeLookup = Record<string, { skins: [{ native: string }] }>;

const EMOJI_CATEGORIES = [
  'people',
  'nature',
  'foods',
  'activity',
  'places',
  'objects',
  'symbols',
  'flags',
] as const;

const inputPath = resolve(
  import.meta.dirname,
  '../node_modules/@emoji-mart/data/sets/15/native.json',
);

const raw: EmojiData = JSON.parse(readFileSync(inputPath, 'utf8'));

// Build lookup in category order so consumers get UX-friendly suggestion order.
const lookup: NativeLookup = {};
for (const catId of EMOJI_CATEGORIES) {
  const cat = raw.categories.find((c) => c.id === catId);
  if (!cat) continue;
  for (const name of cat.emojis) {
    const native = raw.emojis[name]?.skins?.[0]?.native;
    if (native) lookup[name] = { skins: [{ native }] };
  }
}

const distDir = resolve(import.meta.dirname, '../dist');
mkdirSync(distDir, { recursive: true });

// Emit as an ES module so TypeScript resolves index.d.ts for types
// instead of inferring a 1870-key literal type from the raw JSON.
const jsPath = resolve(distDir, 'index.js');
writeFileSync(
  jsPath,
  `// Generated — do not edit. Run \`node bin/extract.ts\` to regenerate.\nexport default ${JSON.stringify(lookup)};\n`,
  'utf8',
);
console.log(`Wrote ${Object.keys(lookup).length} entries to ${jsPath}`);

const dtsPath = resolve(distDir, 'index.d.ts');
writeFileSync(
  dtsPath,
  [
    'export type NativeLookup = Record<string, { skins: [{ native: string }] }>;',
    'declare const _default: NativeLookup;',
    'export default _default;',
    '',
  ].join('\n'),
  'utf8',
);
console.log(`Wrote ${dtsPath}`);
