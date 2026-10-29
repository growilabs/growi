import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildAliases, buildLookup, type EmojiData } from './build-lookup.ts';

const SKIN_TONE_MODIFIERS = [
  '\u{1F3FB}',
  '\u{1F3FC}',
  '\u{1F3FD}',
  '\u{1F3FE}',
  '\u{1F3FF}',
];

const raw: EmojiData = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../node_modules/@emoji-mart/data/sets/15/native.json',
    ),
    'utf8',
  ),
);

const baseline: Record<string, string> = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../test/fixtures/native-first-skin-baseline.json',
    ),
    'utf8',
  ),
);

const lookup = buildLookup(raw);
const aliases = buildAliases(raw, lookup);

describe('buildLookup', () => {
  describe('default glyph (skins[0])', () => {
    it('keeps every default glyph and the category-ordered key order of the pre-skin-tone output', () => {
      const actual = Object.fromEntries(
        Object.entries(lookup).map(([name, v]) => [name, v.skins[0].native]),
      );

      expect(Object.keys(actual)).toEqual(Object.keys(baseline));
      expect(actual).toEqual(baseline);
    });
  });

  describe('skin tone variants', () => {
    const skinToneCapable = Object.keys(lookup).filter(
      (name) => raw.emojis[name].skins.length === 6,
    );
    const notCapable = Object.keys(lookup).filter(
      (name) => raw.emojis[name].skins.length === 1,
    );

    it('has both capable and non-capable emojis in the source data', () => {
      expect(skinToneCapable.length).toBeGreaterThan(0);
      expect(notCapable.length).toBeGreaterThan(0);
    });

    it('emits 6 glyphs for every skin-tone-capable emoji, matching the source data', () => {
      for (const name of skinToneCapable) {
        expect(lookup[name].skins.map((s) => s.native)).toEqual(
          raw.emojis[name].skins.map((s) => s.native),
        );
      }
    });

    it('places the U+1F3FB..U+1F3FF variants at skins[1..5] in order', () => {
      for (const name of skinToneCapable) {
        const { skins } = lookup[name];
        SKIN_TONE_MODIFIERS.forEach((modifier, i) => {
          expect(skins[i + 1].native).toContain(modifier);
        });
      }
    });

    it('emits exactly 1 glyph for emojis without skin tone support', () => {
      for (const name of notCapable) {
        expect(lookup[name].skins).toHaveLength(1);
      }
    });
  });
});

describe('buildAliases', () => {
  it('resolves an alias to its canonical emoji id', () => {
    expect(aliases.thumbsup).toBe('+1');
  });

  it('only maps to canonical ids that exist in the lookup', () => {
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
    for (const target of Object.values(aliases)) {
      expect(lookup).toHaveProperty([target]);
    }
  });
});
