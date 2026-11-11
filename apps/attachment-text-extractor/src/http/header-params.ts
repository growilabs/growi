// A port of what python-multipart 0.0.27's parse_options_header returns
// (email.message._parseparam, email.utils.unquote / decode_params on Python
// 3.12), quirks included: the parse must stay comparable with the recorded
// Python results (research.md 16.1 2, 16.9). Values are latin-1 strings.

export class InvalidMultipart extends Error {}

// Python raises an uncaught TypeError here (the service answered 500); this
// one is answered 422 like any other bad body (research.md 16.1).
export class UnreadableParams extends InvalidMultipart {}

export interface HeaderParams {
  readonly type: string;
  readonly params: Readonly<Record<string, string>>;
}

/** str.count(sub, start, end) with Python slice indices (a negative start counts from the end). */
const count = (s: string, sub: string, from: number, to: number): number => {
  const start = from < 0 ? Math.max(0, s.length + from) : from;
  let n = 0;
  for (
    let i = s.indexOf(sub, start);
    i !== -1 && i + sub.length <= to;
    i = s.indexOf(sub, i + sub.length)
  ) {
    n++;
  }
  return n;
};

// Python's str.strip() whitespace within latin-1 (String#trim() lacks \x1c-\x1f and \x85)
const isWhitespace = (code: number): boolean =>
  (code >= 0x09 && code <= 0x0d) ||
  (code >= 0x1c && code <= 0x20) ||
  code === 0x85 ||
  code === 0xa0;

// Walked from the ends: a regex ending in $ rescans a run of whitespace from
// each of its characters, which is quadratic for a run in the middle.
const lstrip = (v: string): string => {
  let start = 0;
  while (start < v.length && isWhitespace(v.charCodeAt(start))) start++;
  return v.slice(start);
};
const rstrip = (v: string): string => {
  let end = v.length;
  while (end > 0 && isWhitespace(v.charCodeAt(end - 1))) end--;
  return v.slice(0, end);
};
const strip = (v: string): string => lstrip(rstrip(v));

/** The end of the parameter starting at `start`: the next ';' outside double quotes, counted as Python counts them. */
const paramEnd = (s: string, start: number): number => {
  let end = s.indexOf(';', start);
  let ind = start;
  let diff = 0;
  while (end > 0) {
    diff += count(s, '"', ind, end) - count(s, '\\"', ind, end);
    if (diff % 2 === 0) break;
    [end, ind] = [ind, s.indexOf(';', end + 1)];
  }
  return end < 0 ? s.length : end;
};

/** email.message._parseparam: the type, then each parameter with a lower-cased name. */
const splitParams = (value: string): string[] => {
  const s = `;${value}`;
  const out: string[] = [];
  let start = 0;
  while (s.indexOf(';', start) === start) {
    start += 1;
    const end = paramEnd(s, start);
    const f = s.slice(start, end);
    const i = f.indexOf('=');
    out.push(
      strip(
        i === -1
          ? f
          : `${rstrip(f.slice(0, i)).toLowerCase()}=${lstrip(f.slice(i + 1))}`,
      ),
    );
    start = end;
  }
  return out;
};

/** email.utils.unquote */
const unquote = (v: string): string => {
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replaceAll('\\\\', '\\').replaceAll('\\"', '"');
  }
  if (v.length > 1 && v.startsWith('<') && v.endsWith('>')) {
    return v.slice(1, -1);
  }
  return v;
};

const pctDecode = (v: string): string =>
  v.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) =>
    String.fromCharCode(Number.parseInt(h, 16)),
  );

// email.utils.rfc2231_continuation is compiled with re.ASCII, so \w is [A-Za-z0-9_] here too
const RFC2231 = /^(\w+)\*(?:([0-9]+)\*?)?$/;

interface Segment {
  // BigInt: a Python int has no precision limit
  readonly n: bigint | null;
  readonly v: string;
  readonly encoded: boolean;
}

const cmp = <T extends bigint | string | boolean>(x: T, y: T): number =>
  x < y ? -1 : x > y ? 1 : 0;

const bySegment = (x: Segment, y: Segment): number =>
  cmp(x.n ?? 0n, y.n ?? 0n) || cmp(x.v, y.v) || cmp(x.encoded, y.encoded);

/** email.utils.decode_params: name*, name*0*, name*1, ... joined in index order and percent-decoded. */
const joinExtended = (segments: readonly Segment[]): string => {
  const numbered = segments.filter((x) => x.n !== null).length;
  if (numbered !== 0 && numbered !== segments.length) {
    throw new UnreadableParams('mixed RFC 2231 parameters');
  }
  const sorted = [...segments].sort(bySegment);
  const joined = sorted.map((x) => (x.encoded ? pctDecode(x.v) : x.v)).join('');
  if (!sorted.some((x) => x.encoded)) return joined;
  // drop charset'language' (Starlette ignores the charset)
  const q = joined.split("'");
  return q.length >= 3 ? q.slice(2).join("'") : joined;
};

const toPair = (p: string): readonly [string, string] => {
  const eq = p.indexOf('=');
  return eq === -1
    ? [strip(p), '']
    : [strip(p.slice(0, eq)), strip(p.slice(eq + 1))];
};

/** python-multipart's IE6 fix: a Windows path keeps only its last segment. */
const withoutWindowsPath = (filename: string): string =>
  filename.slice(1, 3) === ':\\' || filename.startsWith('\\\\')
    ? (filename.split('\\').pop() ?? filename)
    : filename;

export const parseHeaderParams = (value: string): HeaderParams => {
  // A part named "__proto__" must stay a plain key
  const params: Record<string, string> = Object.create(null);
  if (!value.includes(';')) {
    return { type: strip(value.toLowerCase()), params };
  }
  const [first, ...rest] = splitParams(value).map(toPair);
  const extended = new Map<string, Segment[]>();
  for (const [name, raw] of rest) {
    const v = unquote(raw);
    const m = RFC2231.exec(name);
    if (m === null) {
      params[name] = v;
      continue;
    }
    const base = m[1] ?? '';
    extended.set(base, [
      ...(extended.get(base) ?? []),
      {
        n: m[2] === undefined ? null : BigInt(m[2]),
        v,
        encoded: name.endsWith('*'),
      },
    ]);
  }
  for (const [name, segments] of extended) {
    params[name] = joinExtended(segments);
  }
  if (params.filename !== undefined) {
    params.filename = withoutWindowsPath(params.filename);
  }
  return { type: first?.[0] ?? '', params };
};
