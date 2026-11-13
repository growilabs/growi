// What a conversion child may tell the service log: one code per line on its
// standard error. The child parses hostile files, so the parent never logs the
// bytes it read there. It logs its own sentence for each code it knows and one
// fixed line for everything else (research.md 7.8).

export const CHILD_WARNING_CODES = [
  'oom_score_not_raised',
  'invalid_input_frame',
  'result_not_sent',
  'failed_unexpectedly',
] as const;

export type ChildWarningCode = (typeof CHILD_WARNING_CODES)[number];

/** All the parent keeps of one child's standard error; every code fits in it once. */
export const MAX_CHILD_WARNING_BYTES = 256;

export interface ChildWarnings {
  /** Each code at most once, in the order of first appearance. */
  readonly codes: readonly ChildWarningCode[];
  /** Something else was written too: other text, or more than the parent keeps. */
  readonly unrecognised: boolean;
}

export const NO_CHILD_WARNINGS: ChildWarnings = Object.freeze({
  codes: Object.freeze([]),
  unrecognised: false,
});

const LINE_END = '\n';

const isCode = (line: string): line is ChildWarningCode =>
  CHILD_WARNING_CODES.some((code) => code === line);

export const encodeChildWarning = (code: ChildWarningCode): string =>
  `${code}${LINE_END}`;

/**
 * `kept` is the first bytes of the child's standard error (at most
 * MAX_CHILD_WARNING_BYTES); `overflowed` says the child wrote more than that.
 * Only a whole line that is exactly a code counts.
 */
export const decodeChildWarnings = (
  kept: Uint8Array,
  overflowed: boolean,
): ChildWarnings => {
  const lines = Buffer.from(kept.buffer, kept.byteOffset, kept.byteLength)
    .toString('latin1')
    .split(LINE_END);
  // What follows the last line end is not a whole line.
  const rest = lines.pop() ?? '';
  const codes = new Set<ChildWarningCode>();
  let unrecognised = overflowed || rest !== '';
  for (const line of lines) {
    if (isCode(line)) {
      codes.add(line);
    } else {
      unrecognised = true;
    }
  }
  return { codes: [...codes], unrecognised };
};
