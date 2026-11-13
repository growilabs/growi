import { createHash } from 'node:crypto';

import {
  type MultipartCase,
  PARSER_CASES,
} from '../../test/http/multipart-cases';
import {
  loadMultipartOracle,
  type ParserResult,
} from '../../test/http/multipart-oracle';
import {
  boundaryOf,
  createMultipartParser,
  InvalidMultipart,
} from './parse-multipart';

// The upload parser against what the Python service's parser (Starlette +
// python-multipart, as extract_upload.py drives them) did with the same bodies
// (research.md 16.9 (a); test/http/multipart-oracle.json). Python
// test_extract_router.py's invalid-upload rows are among these bodies.
// Where the request carries a charset, the expectation is Python's answer
// without it: Node does not read the request charset (research.md 7.5 3).

const oracle = loadMultipartOracle();

/** Cases whose Node answer differs from Python's on purpose (research.md 22.6). */
const NODE_DIFFERS: Readonly<
  Record<string, { readonly why: string; readonly expected: ParserResult }>
> = {
  d37: {
    why: 'a CR in the boundary is refused (research.md 7.5 2)',
    expected: { accepted: false },
  },
};

const expectedFor = (c: MultipartCase): ParserResult => {
  const differs = NODE_DIFFERS[c.id];
  if (differs !== undefined) return differs.expected;
  const recorded = oracle.get(c.id);
  const result = recorded?.parserWithoutCharset ?? recorded?.parser;
  if (result === undefined)
    throw new Error(`no recorded parser result for ${c.id}`);
  return result;
};

/** What the parser made of `pieces`, in the oracle's terms. */
const parseIn = (c: MultipartCase, pieces: readonly Buffer[]): ParserResult => {
  try {
    const parser = createMultipartParser(boundaryOf(c.contentType));
    for (const piece of pieces) {
      parser.write(piece);
    }
    const upload = parser.end();
    return {
      accepted: true,
      filename: upload.filename,
      mimeType: upload.mimeHint,
      size: upload.size,
      sha1: createHash('sha1')
        .update(Buffer.concat(upload.chunks))
        .digest('hex'),
    };
  } catch (error) {
    if (error instanceof InvalidMultipart) return { accepted: false };
    throw error;
  }
};

const every = (body: Buffer, size: number): Buffer[] =>
  Array.from({ length: Math.ceil(body.length / size) }, (_, i) =>
    body.subarray(i * size, (i + 1) * size),
  );

const splitPoints = (length: number): number[] =>
  length <= 600
    ? Array.from({ length: Math.max(0, length - 1) }, (_, i) => i + 1)
    : [
        1,
        2,
        3,
        17,
        64,
        Math.floor(length / 3),
        Math.floor(length / 2),
        length - 64,
        length - 3,
        length - 1,
      ];

describe('parse-multipart against the Python parser', () => {
  it('every parser case has a recorded result', () => {
    expect(
      PARSER_CASES.filter((c) => oracle.get(c.id)?.parser === undefined).map(
        (c) => c.id,
      ),
    ).toEqual([]);
  });

  it.each(
    PARSER_CASES.map((c) => [c.id, c.about, c] as const),
  )('%s %s', (_id, _about, c) => {
    expect(parseIn(c, [c.body])).toEqual(expectedFor(c));
  });

  it('[differs from Python] d37: a CR in the boundary is refused, though Python split on it (7.5 2)', () => {
    const d37 = PARSER_CASES.find((c) => c.id === 'd37');
    if (d37 === undefined) throw new Error('no d37');

    expect(oracle.get('d37')?.parser?.accepted).toBe(true);
    expect(parseIn(d37, [d37.body])).toEqual({ accepted: false });
  });

  it('accepts a boundary with only an LF, as Python does (m64)', () => {
    const m64 = PARSER_CASES.find((c) => c.id === 'm64');
    if (m64 === undefined) throw new Error('no m64');

    expect(parseIn(m64, [m64.body])).toMatchObject({
      accepted: true,
      filename: 'a.txt',
    });
  });
});

describe('parse-multipart does not depend on how the body is split', () => {
  it.each(
    PARSER_CASES.map((c) => [c.id, c] as const),
  )('%s: byte by byte and at every split', (_id, c) => {
    const expected = expectedFor(c);

    if (c.body.length <= 8192) {
      expect(parseIn(c, every(c.body, 1))).toEqual(expected);
    }
    for (const at of splitPoints(c.body.length)) {
      expect(
        parseIn(c, [c.body.subarray(0, at), c.body.subarray(at)]),
        `split at ${at}`,
      ).toEqual(expected);
    }
    expect(parseIn(c, every(c.body, 16 * 1024 - 1))).toEqual(expected);
  });
});

describe('boundaryOf', () => {
  it('reads the boundary of multipart/form-data', () => {
    expect(boundaryOf('multipart/form-data; boundary=abc')).toBe('abc');
  });

  it('reads a quoted boundary and the last of two', () => {
    expect(boundaryOf('multipart/form-data; boundary="q b"')).toBe('q b');
    expect(
      boundaryOf('multipart/form-data; boundary=first; boundary=second'),
    ).toBe('second');
  });

  it.each([
    ['another type', 'application/json'],
    ['the type in other case', 'Multipart/Form-Data; boundary=abc'],
    ['no boundary', 'multipart/form-data'],
    ['an empty header', ''],
  ])('refuses %s', (_case, contentType) => {
    expect(() => boundaryOf(contentType)).toThrow(InvalidMultipart);
  });
});
