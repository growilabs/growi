// Scanners that find where an XML construct ends without parsing it. Each
// returns the index just past the construct, or -1 when it never closes; the
// caller then stops, so no position is scanned twice.

const TAG_STOPS = /[>"']/g;
const DOCTYPE_STOPS = /[>["']/g;
const SUBSET_STOPS = /\]|"|'|<!--|<\?/g;

const DOCTYPE_OPENER_LENGTH = '<!DOCTYPE'.length;

const searchFrom = (
  pattern: RegExp,
  text: string,
  from: number,
): RegExpExecArray | null => {
  pattern.lastIndex = from;
  return pattern.exec(text);
};

const skipQuoted = (text: string, quoteAt: number): number => {
  const end = text.indexOf(text[quoteAt], quoteAt + 1);
  return end < 0 ? -1 : end + 1;
};

const skipPast = (text: string, from: number, closer: string): number => {
  const end = text.indexOf(closer, from);
  return end < 0 ? -1 : end + closer.length;
};

const skipInternalSubset = (text: string, from: number): number => {
  for (let pos = from; pos >= 0; ) {
    const match = searchFrom(SUBSET_STOPS, text, pos);
    if (match === null) {
      return -1;
    }
    const after = match.index + match[0].length;
    switch (match[0]) {
      case ']':
        return after;
      case '<!--':
        pos = skipPast(text, after, '-->');
        break;
      case '<?':
        pos = skipPast(text, after, '?>');
        break;
      default:
        pos = skipQuoted(text, match.index);
    }
  }
  return -1;
};

/** Past a DOCTYPE starting at start, respecting quotes and the internal subset's comments. */
export const skipDoctype = (text: string, start: number): number => {
  for (let pos = start + DOCTYPE_OPENER_LENGTH; pos >= 0; ) {
    const match = searchFrom(DOCTYPE_STOPS, text, pos);
    if (match === null) {
      return -1;
    }
    if (match[0] === '>') {
      return match.index + 1;
    }
    pos =
      match[0] === '['
        ? skipInternalSubset(text, match.index + 1)
        : skipQuoted(text, match.index);
  }
  return -1;
};

/** Past the tag starting at start; a ">" inside a quoted attribute value does not end it. */
export const skipTag = (text: string, start: number): number => {
  for (let pos = start + 1; pos >= 0; ) {
    const match = searchFrom(TAG_STOPS, text, pos);
    if (match === null) {
      return -1;
    }
    if (match[0] === '>') {
      return match.index + 1;
    }
    pos = skipQuoted(text, match.index);
  }
  return -1;
};

/** Content start and the index past the closer (-1 when it never closes) of a construct opened at start. */
export const skipToCloser = (
  text: string,
  start: number,
  opener: string,
  closer: string,
): { readonly contentStart: number; readonly after: number } => {
  const contentStart = start + opener.length;
  return { contentStart, after: skipPast(text, contentStart, closer) };
};
