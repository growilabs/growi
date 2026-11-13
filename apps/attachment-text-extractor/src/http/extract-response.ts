import type { PageInfo } from '../contract';

// The 200 body of POST /extract is never built as one string: with three
// ~33 MB results at once that string (and its bytes) is what pushes the
// parent over its memory budget (research.md 20.10). It is written a page and
// a bounded run of content at a time; the bytes are those of one
// JSON.stringify of the whole answer.

export const RESPONSE_PIECE_CHARS = 64 * 1024;

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** Unicode code points, as Python's len() counts them (a lone surrogate is one). */
export const countCodePoints = (text: string): number => {
  let pairs = 0;
  for (let i = 1; i < text.length; i++) {
    if (isLow(text.charCodeAt(i)) && isHigh(text.charCodeAt(i - 1))) {
      pairs++;
      i++;
    }
  }
  return text.length - pairs;
};

// JSON.stringify escapes code unit by code unit except for a surrogate pair,
// which it keeps whole; so a cut anywhere but inside a pair escapes the same.
const cutAt = (text: string, at: number): number =>
  at < text.length &&
  isLow(text.charCodeAt(at)) &&
  isHigh(text.charCodeAt(at - 1))
    ? at - 1
    : at;

/** The JSON string literal of `text`, as the pieces of its content. */
function* stringPieces(text: string, pieceChars: number): Generator<string> {
  yield '"';
  let from = 0;
  while (from < text.length) {
    const cut = cutAt(text, from + pieceChars);
    // a one-character piece that starts a pair takes the whole pair
    const to = cut > from ? cut : from + pieceChars + 1;
    yield JSON.stringify(text.slice(from, to)).slice(1, -1);
    from = to;
  }
  yield '"';
}

function* pagePieces(page: PageInfo, pieceChars: number): Generator<string> {
  yield `{"pageNumber":${JSON.stringify(page.pageNumber)},"label":${JSON.stringify(page.label)},"content":`;
  yield* stringPieces(page.content, pieceChars);
  yield '}';
}

/** The ExtractResponse JSON (pages, mimeType, extractedCharacters, in that order) as bounded pieces. */
export function* extractResponsePieces(
  pages: readonly PageInfo[],
  mimeType: string,
  pieceChars: number = RESPONSE_PIECE_CHARS,
): Generator<string> {
  yield '{"pages":[';
  let characters = 0;
  for (const [i, page] of pages.entries()) {
    if (i > 0) yield ',';
    yield* pagePieces(page, pieceChars);
    characters += countCodePoints(page.content);
  }
  yield `],"mimeType":${JSON.stringify(mimeType)},"extractedCharacters":${characters}}`;
}

const encoder = new TextEncoder();

/** A 200 application/json answer whose body is pulled one piece at a time. */
export const extractResponse = (
  pages: readonly PageInfo[],
  mimeType: string,
): Response => {
  const pieces = extractResponsePieces(pages, mimeType);
  // Sent chunked (no Content-Length), unlike the Python service's answers:
  // the length is only known once the last piece is made.
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const next = pieces.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel: () => {
      pieces.return(undefined);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
