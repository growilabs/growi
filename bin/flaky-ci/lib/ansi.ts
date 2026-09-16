/**
 * Normalization of raw CI job log text.
 *
 * The procedures used to carry two different sed expressions for this —
 * `s/\x1b\[[0-9;]*m//g` (colour only) and `s/\x1b\[[0-9;]*[A-Za-z]//g` (any
 * final byte). The first one left cursor-movement and erase-line sequences in
 * the text, which then broke the literal string matching every later step does.
 * This module is the single rule: one CSI pattern, plus the carriage return a
 * runner writes at the end of a progress line.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is what a CSI sequence starts with.
const CSI_SEQUENCE = /\x1b\[[0-9;]*[A-Za-z]/g;
const TRAILING_CR = /\r$/gm;

/** Removes ANSI CSI sequences and end-of-line carriage returns. */
export const strip = (text: string): string =>
  text.replace(CSI_SEQUENCE, '').replace(TRAILING_CR, '');
