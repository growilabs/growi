export type SpanKind = readonly [open: string, close: string];

/**
 * Same output as replacing /<o1>[\s\S]*?<c1>|<o2>[\s\S]*?<c2>|.../g with
 * `gap`, in linear time: a lazy regex rescans to the end of the text for
 * every unclosed opener. A kind whose closer is missing is never searched
 * again, since no later opener of that kind can be closed either.
 */
export const stripSpans = (
  text: string,
  kinds: readonly SpanKind[],
  gap = '',
): string => {
  const firstChars = new Set(kinds.map(([open]) => open[0]));
  const dead = new Set<string>();
  const pieces: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; ) {
    const next = firstChars.has(text[i]) ? spanEnd(text, i, kinds, dead) : -1;
    if (next < 0) {
      i++;
      continue;
    }
    pieces.push(text.slice(from, i), gap);
    from = next;
    i = next;
  }
  pieces.push(text.slice(from));
  return pieces.join('');
};

/** Where the span opening at `at` ends, or -1 when none opens there. */
const spanEnd = (
  text: string,
  at: number,
  kinds: readonly SpanKind[],
  dead: Set<string>,
): number => {
  for (const [open, close] of kinds) {
    if (dead.has(open) || !text.startsWith(open, at)) {
      continue;
    }
    const end = text.indexOf(close, at + open.length);
    if (end >= 0) {
      return end + close.length;
    }
    dead.add(open);
  }
  return -1;
};
