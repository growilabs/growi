import { describe, expect, it } from 'vitest';

import { strip } from './ansi.ts';

// The two regexes that existed across the shell versions of the procedures:
//   (a) `sed -E 's/\x1b\[[0-9;]*m//g'`        detect-flaky-ci/SKILL.md:275
//   (b) `sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'` detect-flaky-ci/SKILL.md:569, 633
//                                             investigate-flaky-test/SKILL.md:755
// (a) only removes sequences terminated by `m` (colour), so a cursor-movement
// or erase-line sequence survived it and broke literal string matching.
const ESC = '\x1b';

describe('ansi.strip', () => {
  it('removes a colour sequence, which both old regexes handled', () => {
    expect(strip(`${ESC}[31mFAIL${ESC}[0m src/a.spec.ts`)).toBe(
      'FAIL src/a.spec.ts',
    );
  });

  it('removes non-colour sequences that the `m`-only regex left behind', () => {
    // `\x1b[2K` (erase line) and `\x1b[1A` (cursor up) are exactly the inputs
    // on which the two old regexes disagreed.
    expect(strip(`${ESC}[2K${ESC}[1AFAIL src/a.spec.ts`)).toBe(
      'FAIL src/a.spec.ts',
    );
  });

  it('normalizes both old-style inputs to the same text', () => {
    const colourOnly = `${ESC}[31mFAIL${ESC}[39m src/a.spec.ts`;
    const withCursorMoves = `${ESC}[2K${ESC}[31mFAIL${ESC}[39m${ESC}[1A src/a.spec.ts`;
    expect(strip(withCursorMoves)).toBe(strip(colourOnly));
  });

  it('removes a sequence written as literal `^[` caret text, not as an ESC byte', () => {
    // Real shape: an excerpt the `flaky-repro` workflow pastes into an issue
    // comment carries no 0x1b byte at all — see
    // `fixtures/job-logs/11849-repro-result-log-excerpt.txt.meta.md`.
    expect(strip('^[[41m^[[1m FAIL ^[[22m^[[49m src/a.spec.ts')).toBe(
      ' FAIL  src/a.spec.ts',
    );
  });

  it('normalizes the ESC-byte and caret-text spellings of the same log to the same text', () => {
    const escBytes = `${ESC}[41m${ESC}[1m FAIL ${ESC}[22m src/a.spec.ts`;
    const caretText = '^[[41m^[[1m FAIL ^[[22m src/a.spec.ts';

    expect(strip(caretText)).toBe(strip(escBytes));
  });

  it('leaves an ordinary caret that does not open a CSI sequence alone', () => {
    // vitest's error pointer line (`   |     ^`) and a regex anchor are both
    // plain text that must survive.
    expect(strip('   |      ^\nexpected /^a[bc]/ to match')).toBe(
      '   |      ^\nexpected /^a[bc]/ to match',
    );
  });

  it('removes a carriage return at the end of every line', () => {
    expect(strip('a\r\nb\r\nc\r')).toBe('a\nb\nc');
  });

  it('keeps a carriage return that is not at the end of a line', () => {
    expect(strip('a\rb')).toBe('a\rb');
  });

  it('leaves text without escape sequences untouched', () => {
    expect(strip('plain line\nsecond line')).toBe('plain line\nsecond line');
  });

  it('is idempotent', () => {
    const input = `${ESC}[2Ka\r\n${ESC}[31mb${ESC}[0m\r\n`;
    expect(strip(strip(input))).toBe(strip(input));
  });
});
