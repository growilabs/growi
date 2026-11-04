/**
 * Normalization of raw CI job log text.
 *
 * The procedures used to carry two different sed expressions for this —
 * `s/\x1b\[[0-9;]*m//g` (colour only) and `s/\x1b\[[0-9;]*[A-Za-z]//g` (any
 * final byte). The first one left cursor-movement and erase-line sequences in
 * the text, which then broke the literal string matching every later step does.
 * This module is the single rule: one CSI pattern per spelling of the escape
 * (see below), plus the carriage return a runner writes at the end of a
 * progress line.
 *
 * **Two spellings of the same sequence reach these scripts, and both are
 * real.** The `actions/jobs/{JOB_ID}/logs` endpoint returns the true ESC
 * control byte `0x1b` — that is why `gh api` needs `--allow-escape-sequences`
 * to print it at all. But a log excerpt that the `flaky-repro` workflow pasted
 * into an issue comment arrives with every escape already rendered as the
 * two ordinary characters `^` + `[` (caret notation): checked byte by byte,
 * `fixtures/job-logs/11849-repro-result-log-excerpt.txt` contains zero `0x1b`
 * bytes and 258 `^[` pairs (recorded in that fixture's `.meta.md`). `lib/job-log.ts`
 * genuinely reads both spellings — real ESC bytes from the job-log API and
 * caret text pasted into a comment — so `strip` handles both rather than
 * leaving one shape to break the literal string matching every later step
 * does. Giving `parse-job-log.ts` a private stripper for the caret spelling
 * instead of extending `strip` would recreate the exact duplication this
 * module was built to end.
 *
 * A lone `^` is left alone — only `^[[` followed by a CSI body and a final
 * letter is removed — so vitest's error-pointer line (`   |     ^`) and a
 * regex anchor inside an assertion message survive.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is what a CSI sequence starts with.
const CSI_SEQUENCE = /\x1b\[[0-9;]*[A-Za-z]/g;
const CARET_CSI_SEQUENCE = /\^\[\[[0-9;]*[A-Za-z]/g;
const TRAILING_CR = /\r$/gm;

/**
 * Removes ANSI CSI sequences — written as an ESC byte or as literal `^[`
 * caret text — and end-of-line carriage returns.
 */
export const strip = (text: string): string =>
  text
    .replace(CSI_SEQUENCE, '')
    .replace(CARET_CSI_SEQUENCE, '')
    .replace(TRAILING_CR, '');
