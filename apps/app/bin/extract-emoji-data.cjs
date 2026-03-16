#!/usr/bin/env node
/**
 * Extracts a minimal emoji native lookup map from @emoji-mart/data.
 *
 * Run this script from the apps/app/ directory whenever @emoji-mart/data is upgraded:
 *   node bin/extract-emoji-data.cjs
 *
 * Output: src/services/renderer/remark-plugins/emoji-native-lookup.json
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const inputPath = path.resolve(
  __dirname,
  '../node_modules/@emoji-mart/data/sets/15/native.json',
);
const outputPath = path.resolve(
  __dirname,
  '../src/services/renderer/remark-plugins/emoji-native-lookup.json',
);

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

/** @type {Record<string, { skins: [{ native: string }] }>} */
const lookup = {};
for (const [name, entry] of Object.entries(raw.emojis)) {
  const native = entry.skins?.[0]?.native;
  if (native) {
    lookup[name] = { skins: [{ native }] };
  }
}

fs.writeFileSync(outputPath, JSON.stringify(lookup, null, 2) + '\n', 'utf8');
console.log(`Wrote ${Object.keys(lookup).length} entries to ${outputPath}`);
