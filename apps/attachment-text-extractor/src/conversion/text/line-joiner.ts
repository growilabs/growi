import { replaceBatched } from './replace-batched';

// Only ASCII blanks are folded: U+3000 and U+00A0 can be meaningful in
// Japanese text. The patterns match only where folding changes something (a
// lone space or line break is left alone), and replaceBatched keeps the memory
// proportional to a part with many matches (one huge text node).
const LINE_BREAK = /\r\n?/g;
const BLANKS = /[\t\f\v][ \t\f\v]*| [ \t\f\v]+/g;
const LINE_EDGES = / \n[ \n]*|\n[ \n]+/g;

type LastChar = '\n' | ' ' | 'other';

const stripStart = (text: string, chars: string): string => {
  let start = 0;
  while (start < text.length && chars.includes(text[start])) {
    start += 1;
  }
  return text.slice(start);
};

const stripEnd = (text: string, chars: string): string => {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) {
    end -= 1;
  }
  return text.slice(0, end);
};

const toNewline = (): string => '\n';
const toSpace = (): string => ' ';

const fold = (part: string): string =>
  replaceBatched(
    replaceBatched(
      replaceBatched(part, LINE_BREAK, toNewline),
      BLANKS,
      toSpace,
    ),
    LINE_EDGES,
    toNewline,
  );

// Parts joined per batch: tags make one part per word or cell, and millions of
// tiny strings held until the end cost several times the text.
const BATCH_PARTS = 4096;

const classOf = (char: string | undefined): LastChar =>
  char === '\n' || char === ' ' ? char : 'other';

/** Accumulates parts into trimmed, single-spaced lines without blank lines (Python's _LineJoiner). */
export class LineJoiner {
  readonly #batches: string[] = [];
  // Only the last part is ever edited again, so it stays out of the batches.
  #parts: string[] = [];
  // Class of the last emitted character; the start counts as a line break.
  #last: LastChar = '\n';

  add(part: string): void {
    let folded = fold(part);
    if (folded === '') {
      return;
    }
    if (folded[0] === '\n' && this.#last === ' ') {
      this.#parts.push(stripEnd(this.#parts.pop() ?? '', ' '));
      this.#last = 'other';
    }
    if (this.#last === '\n') {
      folded = stripStart(folded, ' \n');
    } else if (this.#last === ' ') {
      folded = stripStart(folded, ' ');
    }
    if (folded === '') {
      return;
    }
    this.#parts.push(folded);
    this.#last = classOf(folded.at(-1));
    if (this.#parts.length >= BATCH_PARTS) {
      const last = this.#parts.pop() ?? '';
      this.#batches.push(this.#parts.join(''));
      this.#parts = [last];
    }
  }

  result(): string {
    return stripEnd([...this.#batches, ...this.#parts].join(''), ' \n');
  }
}
