import type { PageInfo } from '../contract';
import {
  countCodePoints,
  extractResponse,
  extractResponsePieces,
} from './extract-response';

// The 200 body of POST /extract is written in pieces, a page and a bounded
// run of its content at a time, never as one string (research.md 20.10 /
// 20.12): the bytes sent must still be exactly those of one JSON.stringify of
// the whole answer, whatever the piece size and wherever a piece boundary falls.

const PAGES: Readonly<Record<string, readonly PageInfo[]>> = {
  japanese: [
    { pageNumber: 1, label: '1', content: '日本語の本文です。\n二行目' },
    { pageNumber: 2, label: '2', content: '半角ｶﾅと全角カナ' },
  ],
  'control characters, quotes and backslashes': [
    {
      pageNumber: null,
      label: null,
      content: '\u0000\u0001\b\t\n\f\r\u001f"\\/\u007f  ',
    },
  ],
  'surrogate pairs': [
    { pageNumber: 1, label: 'Sheet "1"', content: '𠮷😀a😀😀b𠮷' },
  ],
  'lone surrogates': [
    { pageNumber: 1, label: '1', content: 'a\ud83db\ude00c\ud83d' },
  ],
  'empty pages': [
    { pageNumber: 1, label: '1', content: '' },
    { pageNumber: 2, label: '', content: 'x' },
    { pageNumber: 3, label: '3', content: '' },
  ],
  'no pages': [],
};

const wholeAnswer = (pages: readonly PageInfo[], mimeType: string): Buffer =>
  Buffer.from(
    JSON.stringify({
      pages,
      mimeType,
      extractedCharacters: pages.reduce(
        (sum, page) => sum + [...page.content].length,
        0,
      ),
    }),
    'utf8',
  );

const streamed = (pieces: Iterable<string>): Buffer =>
  Buffer.concat([...pieces].map((piece) => Buffer.from(piece, 'utf8')));

/** Byte equality, reporting where the bytes first differ (deep equality is slow on megabytes). */
const expectSameBytes = (
  actual: Buffer,
  expected: Buffer,
  label = '',
): void => {
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  expect(
    actual.equals(expected),
    `${label} first difference at byte ${at}: ${JSON.stringify(actual.toString('utf8', at, at + 40))} vs ${JSON.stringify(expected.toString('utf8', at, at + 40))}`,
  ).toBe(true);
};

describe('extractResponsePieces', () => {
  it.each(
    Object.entries(PAGES).flatMap(([name, pages]) =>
      [1, 2, 3, 4, 5, 7, 64 * 1024].map((size) => [name, size, pages] as const),
    ),
  )('%s, %i characters a piece: the bytes of one JSON.stringify', (_name, size, pages) => {
    expectSameBytes(
      streamed(extractResponsePieces(pages, 'text/plain', size)),
      wholeAnswer(pages, 'text/plain'),
    );
  });

  it('never splits a surrogate pair, at any boundary', () => {
    const content = '😀'.repeat(50);
    for (let size = 1; size <= 9; size++) {
      for (let lead = 0; lead < size; lead++) {
        const pages = [
          { pageNumber: 1, label: '1', content: 'x'.repeat(lead) + content },
        ];
        expectSameBytes(
          streamed(extractResponsePieces(pages, 'text/plain', size)),
          wholeAnswer(pages, 'text/plain'),
          `size ${size}, lead ${lead}:`,
        );
      }
    }
  });

  it('keeps every piece bounded: a long page is many small pieces', () => {
    const control = '\u0001'.repeat(1_000_000);
    const pages = [{ pageNumber: null, label: null, content: control }];

    const pieces = [...extractResponsePieces(pages, 'text/plain', 4096)];

    expect(pieces.length).toBeGreaterThan(200);
    // 6 bytes per escaped control character, plus the framing around a page
    expect(Math.max(...pieces.map((p) => p.length))).toBeLessThanOrEqual(
      6 * 4096 + 64,
    );
    expectSameBytes(streamed(pieces), wholeAnswer(pages, 'text/plain'));
  });

  it('escapes the mimeType as JSON.stringify does', () => {
    const pages = [{ pageNumber: 1, label: '1', content: 'a' }];

    expectSameBytes(
      streamed(extractResponsePieces(pages, 'text/"odd"\\type', 3)),
      wholeAnswer(pages, 'text/"odd"\\type'),
    );
  });
});

/** Every chunk the answer's body stream yields. */
const writesOf = async (response: Response): Promise<Buffer[]> => {
  const writes: Buffer[] = [];
  const reader = response.body?.getReader();
  for (
    let read = await reader?.read();
    read && !read.done;
    read = await reader?.read()
  ) {
    writes.push(Buffer.from(read.value));
  }
  return writes;
};

describe('extractResponse', () => {
  it('streams the bytes of one JSON.stringify, a long answer never as one write', async () => {
    const pages = [
      { pageNumber: 1, label: '1', content: '😀日本\u0001"'.repeat(60_000) },
      { pageNumber: 2, label: null, content: '' },
    ];

    const response = extractResponse(pages, 'application/pdf');
    const writes = await writesOf(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(writes.length).toBeGreaterThan(3);
    expectSameBytes(
      Buffer.concat(writes),
      wholeAnswer(pages, 'application/pdf'),
    );
  });
});

describe('countCodePoints', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['日本語', 3],
    ['𠮷😀ab', 4],
    ['\ud83d', 1],
    ['\ude00\ud83d', 2],
    ['a😀\ud83d', 3],
  ])('%j has %i code points, as Python len() counts', (text, expected) => {
    expect(countCodePoints(text)).toBe(expected);
    expect(countCodePoints(text)).toBe([...text].length);
  });
});
