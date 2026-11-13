// Pieces joined per batch. String#replace keeps every match until it returns
// (about 25 times the text for millions of short matches); joining as it goes
// keeps the peak near the size of the result.
const BATCH_PIECES = 8192;

/** String#replace for a global pattern, with memory proportional to the text however many matches it has. */
export const replaceBatched = (
  text: string,
  globalPattern: RegExp,
  replace: (match: RegExpExecArray) => string,
): string => {
  if (!globalPattern.global) {
    throw new TypeError('replaceBatched needs a global pattern');
  }
  const batches: string[] = [];
  let pieces: string[] = [];
  let copiedTo = 0;
  globalPattern.lastIndex = 0;
  for (
    let match = globalPattern.exec(text);
    match !== null;
    match = globalPattern.exec(text)
  ) {
    // Stepping past an empty match is unsafe: with the u flag, V8 moves a
    // lastIndex inside a surrogate pair back to its start and loops forever.
    // No caller's pattern can match nothing, so one that does is a bug.
    if (match[0] === '') {
      throw new TypeError(
        'replaceBatched needs a pattern that never matches empty',
      );
    }
    pieces.push(text.slice(copiedTo, match.index), replace(match));
    copiedTo = match.index + match[0].length;
    if (pieces.length >= BATCH_PIECES) {
      batches.push(pieces.join(''));
      pieces = [];
    }
  }
  if (copiedTo === 0 && batches.length === 0 && pieces.length === 0) {
    return text;
  }
  pieces.push(text.slice(copiedTo));
  batches.push(pieces.join(''));
  return batches.join('');
};
