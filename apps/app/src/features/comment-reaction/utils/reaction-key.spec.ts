import pickerData from '@emoji-mart/data/sets/15/native.json';
import emojiNativeLookup from '@growi/emoji-mart-data';

import type { ReactionKey } from '../interfaces';
import {
  fromPickerSelection,
  normalizeReactionKey,
  parseReactionKey,
  resolveReactionGlyph,
  toSlackReactionName,
  tryParseReactionKey,
} from './reaction-key';

type PickerEmoji = { id: string; skins: { native: string }[] };

const unwrap = (input: string) => {
  const result = normalizeReactionKey(input);
  if (!result.ok) {
    throw new Error(`expected "${input}" to be accepted`);
  }
  return result.value;
};

describe('normalizeReactionKey', () => {
  it('accepts a canonical key and returns it unchanged', () => {
    expect(normalizeReactionKey('unicode:+1')).toEqual({
      ok: true,
      value: 'unicode:+1',
    });
  });

  it('resolves an alias to the canonical emoji id', () => {
    expect(normalizeReactionKey('unicode:thumbsup')).toEqual({
      ok: true,
      value: 'unicode:+1',
    });
  });

  it.each([2, 3, 4, 5, 6])('accepts skin tone %i', (tone) => {
    expect(normalizeReactionKey(`unicode:+1::skin-tone-${tone}`)).toEqual({
      ok: true,
      value: `unicode:+1::skin-tone-${tone}`,
    });
  });

  it('resolves an alias while keeping the skin tone', () => {
    expect(normalizeReactionKey('unicode:thumbsup::skin-tone-3')).toEqual({
      ok: true,
      value: 'unicode:+1::skin-tone-3',
    });
  });

  it.each([
    '02',
    '002',
    '+2',
    ' 2',
    '2 ',
  ])('rejects the non-canonical skin tone suffix %j as malformed', (suffix) => {
    const result = normalizeReactionKey(`unicode:+1::skin-tone-${suffix}`);
    expect(!result.ok && result.error.kind).toBe('malformed');
  });

  it.each([1, 7, 0])('rejects skin tone %i as malformed', (tone) => {
    const result = normalizeReactionKey(`unicode:+1::skin-tone-${tone}`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('malformed');
  });

  it('rejects a skin tone on an emoji that does not support one', () => {
    const result = normalizeReactionKey('unicode:100::skin-tone-2');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'skin-tone-not-supported', shortcode: '100' },
    });
  });

  it('rejects an emoji that does not exist', () => {
    expect(normalizeReactionKey('unicode:no_such_emoji_xyz')).toEqual({
      ok: false,
      error: { kind: 'unknown-emoji', shortcode: 'no_such_emoji_xyz' },
    });
  });

  it.each([
    'constructor',
    '__proto__',
    'toString',
  ])('treats the Object.prototype name %s as an unknown emoji', (name) => {
    const result = normalizeReactionKey(`unicode:${name}`);
    expect(!result.ok && result.error.kind).toBe('unknown-emoji');
  });

  it('rejects a namespace other than unicode', () => {
    expect(normalizeReactionKey('custom:party')).toEqual({
      ok: false,
      error: { kind: 'unsupported-namespace', namespace: 'custom' },
    });
  });

  it.each([
    '',
    '+1',
    'unicode:',
    'unicode:+1::',
    'unicode:+1::skin-tone-',
    'unicode:+1::skin-tone-abc',
    'unicode:+1::skin-tone-2::skin-tone-3',
    'unicode:+1::tone-2',
    ':+1',
  ])('rejects the malformed input %j', (input) => {
    const result = normalizeReactionKey(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('malformed');
  });

  it('is idempotent for already-normalized keys', () => {
    const once = unwrap('unicode:thumbsup::skin-tone-4');
    expect(normalizeReactionKey(once)).toEqual({ ok: true, value: once });
  });

  it('accepts every emoji the picker can select, with and without skin tones', () => {
    const emojis = Object.values(
      (pickerData as unknown as { emojis: Record<string, PickerEmoji> }).emojis,
    );
    expect(emojis.length).toBeGreaterThan(1000);

    const rejected: string[] = [];
    for (const emoji of emojis) {
      const tones = emoji.skins.length === 1 ? [undefined] : [1, 2, 3, 4, 5, 6];
      for (const skin of tones) {
        const selection =
          skin === undefined
            ? { kind: 'native' as const, id: emoji.id }
            : { kind: 'native' as const, id: emoji.id, skin };
        const result = fromPickerSelection(selection);
        if (!result.ok) {
          rejected.push(`${emoji.id}/${skin}`);
          continue;
        }
        const again = normalizeReactionKey(result.value);
        if (!again.ok || again.value !== result.value) {
          rejected.push(`${emoji.id}/${skin} (not idempotent)`);
        }
      }
    }
    expect(rejected).toEqual([]);
  });
});

describe('parseReactionKey', () => {
  it('returns the shortcode and a null skin tone for a plain key', () => {
    expect(parseReactionKey(unwrap('unicode:+1'))).toEqual({
      namespace: 'unicode',
      shortcode: '+1',
      skinTone: null,
    });
  });

  it('returns the skin tone as a number', () => {
    expect(parseReactionKey(unwrap('unicode:+1::skin-tone-5'))).toEqual({
      namespace: 'unicode',
      shortcode: '+1',
      skinTone: 5,
    });
  });
});

// A persisted key can be malformed or outlive the emoji data, so these inputs bypass normalizeReactionKey.
const MALFORMED_KEYS = [
  'garbage',
  'unicode:',
  ':+1',
  'unicode:+1::skin-tone-9',
  'unicode:+1:extra',
  'custom:+1',
];

describe('tryParseReactionKey', () => {
  it('returns the same result as parseReactionKey for a valid key', () => {
    const key = unwrap('unicode:+1::skin-tone-3');

    expect(tryParseReactionKey(key)).toEqual(parseReactionKey(key));
  });

  it.each(
    MALFORMED_KEYS,
  )('returns null instead of throwing for "%s"', (key) => {
    expect(tryParseReactionKey(key)).toBeNull();
  });

  it('returns null for a well-formed key outside the unicode namespace', () => {
    expect(tryParseReactionKey('custom:party')).toBeNull();
  });
});

describe('parseReactionKey on invalid keys', () => {
  it.each(MALFORMED_KEYS)('throws for "%s"', (key) => {
    expect(() => parseReactionKey(key as ReactionKey)).toThrow(
      `Not a valid reaction key: ${key}`,
    );
  });
});

describe('fromPickerSelection', () => {
  it.each([undefined, 1])('treats skin %s as no skin tone', (skin) => {
    expect(fromPickerSelection({ kind: 'native', id: '+1', skin })).toEqual({
      ok: true,
      value: 'unicode:+1',
    });
  });

  it('maps skin 2..6 to the matching skin-tone suffix', () => {
    expect(fromPickerSelection({ kind: 'native', id: '+1', skin: 3 })).toEqual({
      ok: true,
      value: 'unicode:+1::skin-tone-3',
    });
  });

  it('rejects an unknown picker id', () => {
    const result = fromPickerSelection({
      kind: 'native',
      id: 'no_such_emoji_xyz',
    });
    expect(!result.ok && result.error.kind).toBe('unknown-emoji');
  });

  it.each([
    2.5,
    Number.NaN,
    -1,
    0,
  ])('rejects the non-tone skin number %s as malformed', (skin) => {
    const result = fromPickerSelection({ kind: 'native', id: '+1', skin });
    expect(!result.ok && result.error.kind).toBe('malformed');
  });

  it('rejects an out-of-range skin number', () => {
    expect(fromPickerSelection({ kind: 'native', id: '+1', skin: 7 }).ok).toBe(
      false,
    );
  });

  it('rejects a skin tone on an emoji without skin tones', () => {
    const result = fromPickerSelection({ kind: 'native', id: '100', skin: 2 });
    expect(!result.ok && result.error.kind).toBe('skin-tone-not-supported');
  });

  it('rejects a selection of an unsupported kind as malformed instead of treating it as a unicode key', () => {
    // Stands in for a kind added to the picker before fromPickerSelection learns it.
    const selection = { kind: 'custom', id: '+1' } as unknown as Parameters<
      typeof fromPickerSelection
    >[0];

    const result = fromPickerSelection(selection);

    expect(!result.ok && result.error.kind).toBe('malformed');
  });
});

describe('toSlackReactionName', () => {
  it('strips the namespace', () => {
    expect(toSlackReactionName(unwrap('unicode:+1'))).toBe('+1');
  });

  it('keeps the skin-tone suffix', () => {
    expect(toSlackReactionName(unwrap('unicode:+1::skin-tone-3'))).toBe(
      '+1::skin-tone-3',
    );
  });

  it('is one-to-one with the key across all emojis in the data', () => {
    const names = Object.keys(emojiNativeLookup).map((id) =>
      toSlackReactionName(unwrap(`unicode:${id}`)),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('resolveReactionGlyph', () => {
  it('returns the default glyph for a key without a skin tone', () => {
    expect(resolveReactionGlyph(unwrap('unicode:+1'))).toBe('👍');
  });

  it.each([
    [2, '👍🏻'],
    [3, '👍🏼'],
    [4, '👍🏽'],
    [5, '👍🏾'],
    [6, '👍🏿'],
  ])('returns the glyph that matches skin tone %i', (tone, glyph) => {
    expect(resolveReactionGlyph(unwrap(`unicode:+1::skin-tone-${tone}`))).toBe(
      glyph,
    );
  });

  it('returns null for a stored key the emoji data no longer knows', () => {
    // A key persisted earlier whose emoji was dropped from the data; it cannot come from normalizeReactionKey.
    const stale = 'unicode:removed_emoji_xyz' as ReturnType<typeof unwrap>;
    expect(resolveReactionGlyph(stale)).toBeNull();
  });

  it('returns null for a stored key in a namespace other than unicode', () => {
    // A key in another namespace cannot come from normalizeReactionKey; simulate a stored row.
    const foreign = 'custom:+1' as ReturnType<typeof unwrap>;
    expect(resolveReactionGlyph(foreign)).toBeNull();
  });
});
