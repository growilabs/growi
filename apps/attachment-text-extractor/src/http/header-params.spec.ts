import { headerParamSamples } from '../../test/http/header-param-samples';
import { loadHeaderParamOracle } from '../../test/http/multipart-oracle';
import {
  InvalidMultipart,
  parseHeaderParams,
  UnreadableParams,
} from './header-params';

// The part-header parameter parser is a port of what python-multipart's
// parse_options_header returns (Python's email.message._parseparam,
// email.utils.unquote / decode_params), quirks included (research.md 16.1 2,
// 16.9 (a)). The samples are random values built from the fragments that
// exposed differences before (16.10): non-ASCII parameter names and
// continuation numbers past 2^53 among them.

const parsed = (
  value: string,
): { readonly type: string; readonly params: Record<string, string> } => {
  const result = parseHeaderParams(value);
  return { type: result.type, params: { ...result.params } };
};

describe('parseHeaderParams against python-multipart', () => {
  const samples = headerParamSamples();
  const oracle = loadHeaderParamOracle();

  it('has a recorded result for every sample', () => {
    expect(oracle).toHaveLength(samples.length);
  });

  it.each(
    samples.map((value, i) => [i, value] as const),
  )('sample %i', (i, value) => {
    const expected = oracle[i];
    if (expected?.error !== undefined) {
      expect(() => parseHeaderParams(value)).toThrow(UnreadableParams);
      return;
    }
    expect(parsed(value)).toEqual({
      type: expected?.type,
      params: expected?.params,
    });
  });
});

describe('parseHeaderParams', () => {
  it('reads the type and the quoted parameters', () => {
    expect(parsed('form-data; name="file"; filename="a.txt"')).toEqual({
      type: 'form-data',
      params: { name: 'file', filename: 'a.txt' },
    });
  });

  it('reads a value without parameters as the type alone', () => {
    expect(parsed('Form-Data ')).toEqual({ type: 'form-data', params: {} });
  });

  it("prefers filename* (RFC 5987) over filename, and drops charset'language'", () => {
    expect(
      parsed(
        `form-data; name="file"; filename="fallback.txt"; filename*=UTF-8''%E6%97%A5.txt`,
      ).params.filename,
    ).toBe(Buffer.from('日.txt', 'utf8').toString('latin1'));
  });

  it('joins RFC 2231 continuations in number order', () => {
    expect(
      parsed('form-data; filename*1=".txt"; filename*0="a"').params.filename,
    ).toBe('a.txt');
  });

  it('orders continuation numbers past 2^53 exactly', () => {
    const value =
      'form-data; filename*9007199254740993="a"; filename*9007199254740992="b"';

    // As doubles both numbers are 2^53; sorted by value they would give "ab".
    expect(parsed(value).params.filename).toBe('ba');
  });

  it('does not treat a non-ASCII name as a continuation (re.ASCII)', () => {
    expect(
      Object.keys(parsed('form-data; xé*=v; filename="a.txt"').params),
    ).toContain('xé*');
  });

  it('refuses mixed numbered and unnumbered extended parameters (Python raises TypeError)', () => {
    const value = `form-data; name="file"; filename*=UTF-8''a.txt; filename*0="b.txt"`;

    expect(() => parseHeaderParams(value)).toThrow(UnreadableParams);
    expect(() => parseHeaderParams(value)).toThrow(InvalidMultipart);
  });

  it('keeps only the last segment of a drive path, and leaves a slash path alone', () => {
    expect(
      parsed('form-data; filename="C:\\Users\\x\\a.txt"').params.filename,
    ).toBe('a.txt');
    expect(parsed('form-data; filename="dir/sub/a.txt"').params.filename).toBe(
      'dir/sub/a.txt',
    );
  });

  it('unquotes a quoted UNC path before the path check, so it keeps one leading backslash (as Python)', () => {
    expect(
      parsed('form-data; filename="\\\\server\\share\\a.txt"').params.filename,
    ).toBe('\\server\\share\\a.txt');
  });

  it('unquotes only \\\\ and \\" inside quotes', () => {
    expect(
      parsed('form-data; filename="a\\"b\\\\c\\d.txt"').params.filename,
    ).toBe('a"b\\c\\d.txt');
  });

  it('keeps a parameter named __proto__ as a plain key', () => {
    const result = parseHeaderParams('form-data; __proto__="x"; name="file"');

    expect(
      Object.getOwnPropertyDescriptor(result.params, '__proto__')?.value,
    ).toBe('x');
    expect(result.params.name).toBe('file');
  });

  it('strips the whitespace Python strips, \\x1c-\\x1f, \\x85 and \\xa0 included', () => {
    expect(parsed('form-data; name=\x1c\x85file\xa0').params.name).toBe('file');
  });
});

// Trimming takes time linear in the header length (under 10 ms each here),
// wherever the run of whitespace sits.
describe('parseHeaderParams on a long run of whitespace stays linear', () => {
  const RUN = '\t'.repeat(100_000);

  it.each([
    ['inside a value', `form-data; name="a${RUN}b"`, 'name', `a${RUN}b`],
    ['inside a name', `form-data; a${RUN}b=x; name="file"`, 'name', 'file'],
    ['between parameters', `form-data;${RUN}name="file"${RUN}; x=y`, 'x', 'y'],
  ])('%s', (_id, value, name, expected) => {
    const began = performance.now();
    const { params } = parseHeaderParams(value);
    const ms = performance.now() - began;

    expect(ms).toBeLessThan(1_000);
    expect(params[name]).toBe(expected);
  });

  it('inside a value that has no parameter', () => {
    const began = performance.now();
    const { type } = parseHeaderParams(`Text/Plain${RUN}x`);
    const ms = performance.now() - began;

    expect(ms).toBeLessThan(1_000);
    expect(type).toBe(`text/plain${RUN}x`);
  });
});
