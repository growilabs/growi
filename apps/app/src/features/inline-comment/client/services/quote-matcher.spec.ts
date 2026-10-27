// @vitest-environment happy-dom

import { captureSelection } from '../components/SelectionCapture/use-text-selection';
import { createNormalizedOffsetMapper } from './normalized-offset-mapping';
import {
  FUZZY_MATCH_ERROR_RATE,
  FUZZY_MATCH_MAX_ERRORS,
  type InlineCommentAnchor,
  matchQuote,
} from './quote-matcher';
import { renderedTextOf } from './rendered-text';

const anchorOf = (
  quote: string,
  approxOffset: number,
  context: { prefix?: string; suffix?: string } = {},
): InlineCommentAnchor => ({
  quote,
  prefix: context.prefix ?? '',
  suffix: context.suffix ?? '',
  approxOffset,
});

/** The text actually covered by a result, or null when nothing matched. */
const matchedTextOf = (
  text: string,
  result: ReturnType<typeof matchQuote>,
): string | null =>
  result.startOffset == null || result.endOffset == null
    ? null
    : text.slice(result.startOffset, result.endOffset);

describe('matchQuote', () => {
  describe('exact match', () => {
    it('prefers an exact occurrence over a closer fuzzy-matchable one', () => {
      // The fuzzy-only occurrence sits at the very start and is the closest to
      // approxOffset, so a fuzzy-first implementation would report offset 0.
      const text = 'quikc brown fox ate the quick brown fox';
      const exactStart = text.indexOf('quick brown fox');

      const result = matchQuote(text, anchorOf('quick brown fox', 0));

      expect(result).toEqual({
        status: 'exact',
        startOffset: exactStart,
        endOffset: exactStart + 'quick brown fox'.length,
      });
    });

    it('picks the occurrence closest to approxOffset when the quote repeats', () => {
      const text = 'alpha needle beta gamma delta needle omega';
      const secondStart = text.lastIndexOf('needle');

      const nearFirst = matchQuote(text, anchorOf('needle', 4));
      const nearSecond = matchQuote(text, anchorOf('needle', 34));

      expect(nearFirst).toEqual({
        status: 'exact',
        startOffset: text.indexOf('needle'),
        endOffset: text.indexOf('needle') + 'needle'.length,
      });
      expect(nearSecond).toEqual({
        status: 'exact',
        startOffset: secondStart,
        endOffset: secondStart + 'needle'.length,
      });
    });
  });

  describe('fuzzy match', () => {
    it('picks the fuzzy candidate closest to approxOffset when the quote repeats', () => {
      // Both occurrences are misspelled, so there is no exact match at all and
      // the fuzzy search returns two candidates.
      const text =
        'alpha quikc brown fox beta gamma delta quikc brown fox omega';
      const firstStart = text.indexOf('quikc brown fox');
      const secondStart = text.lastIndexOf('quikc brown fox');

      const nearFirst = matchQuote(text, anchorOf('quick brown fox', 6));
      const nearSecond = matchQuote(text, anchorOf('quick brown fox', 39));

      expect(nearFirst.status).toBe('fuzzy');
      expect(nearFirst.startOffset).toBe(firstStart);
      expect(nearSecond.status).toBe('fuzzy');
      expect(nearSecond.startOffset).toBe(secondStart);
    });

    it('compares approxOffset with the candidates in normalized coordinates', () => {
      // Ten composition-exclusion characters up front: each is one code unit in
      // the original text and two once normalized, so the candidates sit ten
      // code units later in normalized coordinates than in the original. The
      // anchor is placed just past the midpoint between the two occurrences, so
      // comparing a raw approxOffset against normalized candidate starts picks
      // the wrong one.
      const text = `${'क़'.repeat(10)} alpha quikc brown fox beta gamma delta quikc brown fox omega`;
      const secondStart = text.lastIndexOf('quikc brown fox');
      const midpoint = Math.floor(
        (text.indexOf('quikc brown fox') + secondStart) / 2,
      );

      const result = matchQuote(
        text,
        anchorOf('quick brown fox', midpoint + 5),
      );

      expect(result.status).toBe('fuzzy');
      expect(result.startOffset).toBe(secondStart);
    });

    it('returns not_found when neither an exact nor a fuzzy match exists', () => {
      const result = matchQuote(
        'nothing here resembles the stored selection',
        anchorOf('completely unrelated wording', 0),
      );

      expect(result).toEqual({
        status: 'not_found',
        startOffset: null,
        endOffset: null,
      });
    });
  });

  describe('maxErrors', () => {
    // 10 code units: the rate alone allows Math.ceil(10 * 0.2) = 2 errors.
    const shortQuote = 'abcdefghij';
    // 200 code units: the rate alone would allow 40 errors, so the cap decides.
    const longQuote = Array.from(
      { length: 200 },
      (_, i) => 'abcdefghijklmnopqrstuvwxyz'[i % 26],
    ).join('');

    const perturbLongQuote = (errorCount: number): string => {
      const chars = [...longQuote];
      for (let i = 0; i < errorCount; i++) {
        chars[i * 9 + 3] = '#';
      }
      return `pad ${chars.join('')} pad`;
    };

    it('accepts a short quote within the rate but rejects one error beyond it', () => {
      const withinRate = matchQuote(
        'zzz abXdeYghij zzz',
        anchorOf(shortQuote, 4),
      );
      const beyondRate = matchQuote(
        'zzz abXdeYghZj zzz',
        anchorOf(shortQuote, 4),
      );

      expect(withinRate.status).toBe('fuzzy');
      expect(matchedTextOf('zzz abXdeYghij zzz', withinRate)).toBe(
        'abXdeYghij',
      );
      expect(beyondRate.status).toBe('not_found');
    });

    it('caps a long quote at the fixed maximum instead of using the rate', () => {
      // Both error counts are far below the rate's own allowance (40), so only
      // the cap can distinguish them.
      const atCap = matchQuote(
        perturbLongQuote(FUZZY_MATCH_MAX_ERRORS),
        anchorOf(longQuote, 4),
      );
      const beyondCap = matchQuote(
        perturbLongQuote(FUZZY_MATCH_MAX_ERRORS + 1),
        anchorOf(longQuote, 4),
      );

      expect(
        Math.ceil(longQuote.length * FUZZY_MATCH_ERROR_RATE),
      ).toBeGreaterThan(FUZZY_MATCH_MAX_ERRORS);
      expect(atCap.status).toBe('fuzzy');
      expect(atCap.startOffset).toBe(4);
      expect(beyondCap.status).toBe('not_found');
    });
  });

  describe('offsets in NFC-normalized text are converted back to the original text', () => {
    it('reports offsets shifted by a character NFC expands', () => {
      // U+0958 is a composition exclusion: NFC decomposes it into two code
      // units, so every offset after it differs between the two forms.
      const text = 'Hello क़ world quick brown fox tail';
      const anchor = anchorOf('quick brwn fox', text.indexOf('quick'));

      const result = matchQuote(text, anchor);

      expect(result.status).toBe('fuzzy');
      expect(matchedTextOf(text, result)).toBe('quick brown fox');

      // The reported range, normalized, must cover what was matched in the
      // normalized text — proving the conversion is not an accidental
      // pass-through of the normalized offsets.
      const mapper = createNormalizedOffsetMapper(text);
      expect(mapper.normalizedText.length).not.toBe(text.length);
      expect(
        text
          .slice(result.startOffset ?? 0, result.endOffset ?? 0)
          .normalize('NFC'),
      ).toContain('quick brown fox');
    });

    it('keeps the whole character when a match ends inside one NFC rewrote', () => {
      // The quote ends with the base letter alone (U+0915) while the text holds
      // the precomposed U+0958, so the match ends halfway through the character
      // once the text is normalized.
      const text = 'foo क़bar';
      const anchor = anchorOf('foo क', 0);

      const result = matchQuote(text, anchor);

      expect(result.status).toBe('fuzzy');
      // Naively converting the end offset would drop the character entirely and
      // report 'foo ' instead.
      expect(matchedTextOf(text, result)).toBe('foo क़');
    });
  });
});

/** A string the fixture below holds twice, both times after the formula. */
const DUPLICATE_QUOTE = 'needle';

/**
 * The formula text KaTeX keeps under its `.katex` root — once as an
 * accessibility-only MathML tree, once as the visual tree, so those characters
 * exist twice in the DOM.
 */
const FORMULA_TEXT = 'x2+y2=z2+w2';

const PROSE_BEFORE_FORMULA = 'Before the formula: ';

const TAIL_TEXT = `See ${DUPLICATE_QUOTE} here and ${DUPLICATE_QUOTE} again.`;

/**
 * Mirrors a page body of: prose, a KaTeX-rendered formula, then a tail holding
 * the same string twice.
 *
 * A naive character count (the container's raw `textContent`, or
 * `Range.toString()`) counts the formula's characters twice, while highlight
 * resolution skips the whole `.katex` subtree — so every position after the
 * formula is counted differently by the two sides unless both go through one
 * counting rule.
 *
 * Fixture invariant, asserted in the test: that per-side difference must be
 * LARGER than the gap between the two occurrences of `DUPLICATE_QUOTE`. Only
 * then does a naively counted offset for the first occurrence land past the
 * second one, making a disagreement observable as *the wrong occurrence being
 * chosen* rather than as a shifted offset that still happens to be nearest the
 * right one. Keep the formula text long enough (and the two occurrences close
 * enough together) that this holds.
 */
const mountPageWithFormulaBeforeDuplicateQuote = (): {
  container: HTMLDivElement;
  tailNode: Text;
} => {
  const container = document.createElement('div');

  const katexRoot = document.createElement('span');
  katexRoot.className = 'katex';
  const mathml = document.createElement('span');
  mathml.className = 'katex-mathml';
  mathml.textContent = FORMULA_TEXT;
  const katexHtml = document.createElement('span');
  katexHtml.className = 'katex-html';
  katexHtml.setAttribute('aria-hidden', 'true');
  katexHtml.textContent = FORMULA_TEXT;
  katexRoot.append(mathml, katexHtml);

  const tailNode = document.createTextNode(TAIL_TEXT);
  container.append(
    document.createTextNode(PROSE_BEFORE_FORMULA),
    katexRoot,
    tailNode,
  );
  document.body.appendChild(container);

  return { container, tailNode };
};

/** Selects [start, end) of `textNode` as the live window selection. */
const selectIn = (textNode: Text, start: number, end: number): Selection => {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  if (selection == null) {
    throw new Error('window.getSelection() returned null');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

describe('matchQuote with an anchor captured from a live DOM', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  it('resolves a quote selected right after a formula to that occurrence, not to a later duplicate', () => {
    const { container, tailNode } = mountPageWithFormulaBeforeDuplicateQuote();
    const { text } = renderedTextOf(container);

    const selectedOccurrence = text.indexOf(DUPLICATE_QUOTE);
    const laterOccurrence = text.lastIndexOf(DUPLICATE_QUOTE);
    const naiveOccurrence = (container.textContent ?? '').indexOf(
      DUPLICATE_QUOTE,
    );

    // Guard the fixture: it must still pose the problem this test is about —
    // exactly two occurrences, and a per-side counting difference wider than
    // the gap between them (see the fixture's invariant above).
    expect(text.split(DUPLICATE_QUOTE)).toHaveLength(3);
    expect(laterOccurrence).toBeGreaterThan(selectedOccurrence);
    expect(naiveOccurrence - selectedOccurrence).toBeGreaterThan(
      laterOccurrence - selectedOccurrence,
    );

    // Select the earlier of the two occurrences — the one right after the formula.
    const selectionStart = TAIL_TEXT.indexOf(DUPLICATE_QUOTE);
    const captured = captureSelection(
      selectIn(
        tailNode,
        selectionStart,
        selectionStart + DUPLICATE_QUOTE.length,
      ),
      container,
    );
    if (captured == null) {
      throw new Error(
        'captureSelection returned null for a non-empty selection',
      );
    }
    expect(captured.quote).toBe(DUPLICATE_QUOTE);

    // The anchor as recorded at comment-creation time, resolved against the very
    // same body it was captured from, must land back on the same words.
    const result = matchQuote(text, captured);

    expect(result).toEqual({
      status: 'exact',
      startOffset: selectedOccurrence,
      endOffset: selectedOccurrence + DUPLICATE_QUOTE.length,
    });
  });
});
