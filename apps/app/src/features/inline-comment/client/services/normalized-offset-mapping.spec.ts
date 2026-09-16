import {
  createNormalizedOffsetMapper,
  mapNormalizedOffsetToOriginal,
} from './normalized-offset-mapping';

/**
 * Fixtures are written with explicit escapes (never with pre-composed literals) so the
 * intended code units survive any editor / encoding round-trip, and each test asserts the
 * fixture's own code-unit counts first — a fixture that silently stopped changing length
 * under NFC would make the whole suite pass vacuously.
 */

/** `"e" + COMBINING ACUTE ACCENT` — 2 code units that NFC composes into 1 (U+00E9). */
const COMBINING_E_ACUTE = 'e\u0301';

/**
 * DEVANAGARI LETTER QA. A composition exclusion: NFC canonically decomposes it into
 * `U+0915 U+093C` and does NOT recompose, so 1 code unit becomes 2.
 */
const DEVANAGARI_QA = '\u0958';

/** HANGUL CHOSEONG KIYEOK + JUNGSEONG A — 2 code units that NFC composes into 1 (U+AC00). */
const HANGUL_JAMO_GA = '\u1100\u1161';

/** `q` + COMBINING DOT BELOW + COMBINING DOT ABOVE — 3 code units, unchanged by NFC. */
const UNCHANGED_COMBINING_Q = 'q\u0323\u0307';

/**
 * `a` + COMBINING DIAERESIS AND ACUTE. NFC rewrites it into `U+00E4 U+0301`: the same number
 * of code units, but different ones, so the two forms still have no aligned interior and a
 * mapping that only compares lengths would wrongly treat this segment as untouched.
 */
const REWRITTEN_SAME_LENGTH = 'a\u0344';

/** Shrinks at offset 4, grows at offset 8, shrinks again at offset 10. */
const MIXED = `abc ${COMBINING_E_ACUTE}f ${DEVANAGARI_QA} ${HANGUL_JAMO_GA} xyz`;

describe('mapNormalizedOffsetToOriginal', () => {
  it('maps every offset of an ASCII-only text to itself, since NFC leaves it untouched', () => {
    const original = 'plain ascii text';
    const normalized = original.normalize('NFC');
    expect(normalized).toBe(original);

    for (let offset = 0; offset <= normalized.length; offset++) {
      expect(mapNormalizedOffsetToOriginal(original, normalized, offset)).toBe(
        offset,
      );
    }
  });

  it('maps every offset of a non-ASCII but NFC-stable text to itself', () => {
    const original = '日本語のテキスト';
    const normalized = original.normalize('NFC');
    expect(normalized).toBe(original);

    for (let offset = 0; offset <= normalized.length; offset++) {
      expect(mapNormalizedOffsetToOriginal(original, normalized, offset)).toBe(
        offset,
      );
    }
  });

  it('shifts offsets that follow a combining sequence NFC composed into fewer code units', () => {
    const original = `caf${COMBINING_E_ACUTE} ok`;
    const normalized = original.normalize('NFC');
    expect(original).toHaveLength(8);
    expect(normalized).toHaveLength(7);

    // "caf" is unaffected
    expect(mapNormalizedOffsetToOriginal(original, normalized, 3)).toBe(3);
    // the composed "é" occupies [3, 4) normalized / [3, 5) original
    expect(mapNormalizedOffsetToOriginal(original, normalized, 4)).toBe(5);
    // everything after it keeps the +1 shift
    expect(mapNormalizedOffsetToOriginal(original, normalized, 5)).toBe(6);
    expect(
      mapNormalizedOffsetToOriginal(original, normalized, normalized.length),
    ).toBe(original.length);
  });

  it('shifts offsets that follow a character NFC decomposed into more code units', () => {
    const original = `x${DEVANAGARI_QA}y`;
    const normalized = original.normalize('NFC');
    expect(original).toHaveLength(3);
    expect(normalized).toHaveLength(4);

    expect(mapNormalizedOffsetToOriginal(original, normalized, 1)).toBe(1);
    // the decomposed letter occupies [1, 3) normalized / [1, 2) original
    expect(mapNormalizedOffsetToOriginal(original, normalized, 3)).toBe(2);
    expect(
      mapNormalizedOffsetToOriginal(original, normalized, normalized.length),
    ).toBe(original.length);
  });

  it('maps an offset that falls inside a re-composed sequence to the start of that sequence', () => {
    const original = `caf${COMBINING_E_ACUTE} ok`;
    const normalized = original.normalize('NFC');

    // Original and normalized forms of "é" have no aligned interior structure, so an
    // interior offset rounds down to the start of the sequence rather than guessing.
    expect(mapNormalizedOffsetToOriginal(original, normalized, 3)).toBe(3);
  });

  it('rounds down inside a sequence NFC rewrote without changing its code unit count', () => {
    const original = `x${REWRITTEN_SAME_LENGTH}y`;
    const normalized = original.normalize('NFC');
    expect(normalized).not.toBe(original);
    expect(normalized).toHaveLength(original.length);

    // The rewritten sequence occupies [1, 3) on both sides, but "a + U+0344" and
    // "U+00E4 + U+0301" do not line up code unit by code unit, so its interior offset must
    // still round down to the start instead of being carried across as-is.
    expect(mapNormalizedOffsetToOriginal(original, normalized, 2)).toBe(1);
    expect(mapNormalizedOffsetToOriginal(original, normalized, 3)).toBe(3);
  });

  it('keeps offsets inside an NFC-stable multi-code-unit grapheme aligned one to one', () => {
    const original = `a${UNCHANGED_COMBINING_Q}b`;
    const normalized = original.normalize('NFC');
    expect(normalized).toBe(original);

    expect(mapNormalizedOffsetToOriginal(original, normalized, 2)).toBe(2);
    expect(mapNormalizedOffsetToOriginal(original, normalized, 3)).toBe(3);
  });

  it('maps offsets across a text with several regions changed in both directions', () => {
    const normalized = MIXED.normalize('NFC');
    expect(MIXED).toHaveLength(16);
    expect(normalized).toHaveLength(15);

    const map = (offset: number) =>
      mapNormalizedOffsetToOriginal(MIXED, normalized, offset);

    expect(map(0)).toBe(0); // start of text
    expect(map(3)).toBe(3); // unaffected ASCII prefix
    expect(map(4)).toBe(4); // start of the composed "é"
    expect(map(5)).toBe(6); // right after the composed "é"
    expect(map(7)).toBe(8); // start of the decomposed devanagari letter
    expect(map(9)).toBe(9); // right after the decomposed devanagari letter
    expect(map(10)).toBe(10); // start of the composed hangul syllable
    expect(map(11)).toBe(12); // right after the composed hangul syllable
    expect(map(12)).toBe(13); // unaffected ASCII suffix
    expect(map(normalized.length)).toBe(MIXED.length); // end of text
  });

  it('never moves backwards as the normalized offset advances', () => {
    const normalized = MIXED.normalize('NFC');

    let previous = -1;
    for (let offset = 0; offset <= normalized.length; offset++) {
      const mapped = mapNormalizedOffsetToOriginal(MIXED, normalized, offset);
      expect(mapped).toBeGreaterThanOrEqual(previous);
      previous = mapped;
    }
  });

  it('clamps an out-of-range offset into the original text instead of throwing', () => {
    const normalized = MIXED.normalize('NFC');

    expect(mapNormalizedOffsetToOriginal(MIXED, normalized, -5)).toBe(0);
    expect(
      mapNormalizedOffsetToOriginal(MIXED, normalized, normalized.length + 100),
    ).toBe(MIXED.length);
  });

  it('returns 0 for an empty text', () => {
    expect(mapNormalizedOffsetToOriginal('', '', 0)).toBe(0);
  });

  it('falls back to a clamped identity mapping when the two texts cannot be walked in parallel', () => {
    // Re-anchoring is best effort (Req 5.3): a caller that passes a text unrelated to the
    // original must get a usable offset back, never an exception.
    const unrelated = 'completely different text';

    expect(mapNormalizedOffsetToOriginal(MIXED, unrelated, 3)).toBe(3);
    expect(
      mapNormalizedOffsetToOriginal(MIXED, unrelated, unrelated.length),
    ).toBe(MIXED.length);
  });
});

describe('createNormalizedOffsetMapper', () => {
  it('exposes the NFC form of the text it was built from', () => {
    const mapper = createNormalizedOffsetMapper(MIXED);

    expect(mapper.normalizedText).toBe(MIXED.normalize('NFC'));
  });

  it('maps normalized offsets the same way as the single-shot function', () => {
    const normalized = MIXED.normalize('NFC');
    const mapper = createNormalizedOffsetMapper(MIXED);

    for (let offset = 0; offset <= normalized.length; offset++) {
      expect(mapper.toOriginalOffset(offset)).toBe(
        mapNormalizedOffsetToOriginal(MIXED, normalized, offset),
      );
    }
  });

  it('maps an original offset forward onto the normalized text', () => {
    const mapper = createNormalizedOffsetMapper(MIXED);

    expect(mapper.toNormalizedOffset(0)).toBe(0);
    expect(mapper.toNormalizedOffset(3)).toBe(3); // unaffected ASCII prefix
    expect(mapper.toNormalizedOffset(6)).toBe(5); // right after the combining sequence
    expect(mapper.toNormalizedOffset(9)).toBe(9); // right after the devanagari letter
    expect(mapper.toNormalizedOffset(12)).toBe(11); // right after the hangul jamo pair
    expect(mapper.toNormalizedOffset(MIXED.length)).toBe(
      mapper.normalizedText.length,
    );
  });

  it('round-trips every grapheme boundary of the original text', () => {
    const mapper = createNormalizedOffsetMapper(MIXED);
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });

    const boundaries = [...segmenter.segment(MIXED)]
      .map((segment) => segment.index)
      .concat(MIXED.length);
    for (const boundary of boundaries) {
      expect(mapper.toOriginalOffset(mapper.toNormalizedOffset(boundary))).toBe(
        boundary,
      );
    }
  });

  it('clamps out-of-range original offsets instead of throwing', () => {
    const mapper = createNormalizedOffsetMapper(MIXED);

    expect(mapper.toNormalizedOffset(-1)).toBe(0);
    expect(mapper.toNormalizedOffset(MIXED.length + 100)).toBe(
      mapper.normalizedText.length,
    );
  });
});
