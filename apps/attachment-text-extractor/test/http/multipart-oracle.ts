import { readFileSync } from 'node:fs';

// Typed reads of the recorded Python results (multipart-oracle.json and
// header-param-oracle.json). Every field is checked at load, so a damaged file
// fails loudly instead of letting a test compare against undefined.

export interface ParsedUpload {
  readonly accepted: true;
  readonly filename: string;
  readonly mimeType: string | null;
  readonly size: number;
  readonly sha1: string;
}
export type ParserResult = ParsedUpload | { readonly accepted: false };

export interface HttpResult {
  readonly status: number;
  /** The ErrorResponse code; null when the answer has none. */
  readonly code: string | null;
}

export interface OracleEntry {
  readonly requestSha1: string;
  readonly http: HttpResult;
  readonly parser?: ParserResult;
  readonly parserWithoutCharset?: ParserResult;
}

export interface HeaderParamResult {
  readonly type?: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly error?: string;
}

const fail = (what: string): never => {
  throw new Error(`malformed oracle: ${what}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown, what: string): string | null =>
  value === null || typeof value === 'string' ? value : fail(what);

const parserResult = (value: unknown, what: string): ParserResult => {
  if (!isRecord(value)) return fail(what);
  if (value.accepted === false) return { accepted: false };
  const { filename, mimeType, size, sha1 } = value;
  if (
    value.accepted !== true ||
    typeof filename !== 'string' ||
    typeof size !== 'number' ||
    typeof sha1 !== 'string'
  ) {
    return fail(what);
  }
  return {
    accepted: true,
    filename,
    mimeType: stringOrNull(mimeType, what),
    size,
    sha1,
  };
};

const entry = (id: string, value: unknown): OracleEntry => {
  if (
    !isRecord(value) ||
    typeof value.requestSha1 !== 'string' ||
    !isRecord(value.http)
  )
    return fail(id);
  const { status, code } = value.http;
  if (typeof status !== 'number') return fail(id);
  return {
    requestSha1: value.requestSha1,
    http: { status, code: stringOrNull(code, id) },
    ...(value.parser === undefined
      ? {}
      : { parser: parserResult(value.parser, id) }),
    ...(value.parserWithoutCharset === undefined
      ? {}
      : { parserWithoutCharset: parserResult(value.parserWithoutCharset, id) }),
  };
};

const readJson = (name: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(name, import.meta.url), 'utf8'),
  );
  return isRecord(parsed) ? parsed : fail(name);
};

export const loadMultipartOracle = (): ReadonlyMap<string, OracleEntry> => {
  const { cases } = readJson('./multipart-oracle.json');
  if (!isRecord(cases)) return fail('cases');
  return new Map(
    Object.entries(cases).map(([id, value]) => [id, entry(id, value)]),
  );
};

export const loadHeaderParamOracle = (): readonly HeaderParamResult[] => {
  const { results } = readJson('./header-param-oracle.json');
  if (!Array.isArray(results)) return fail('results');
  return results.map((result, i): HeaderParamResult => {
    if (!isRecord(result)) return fail(`result ${i}`);
    if (typeof result.error === 'string') return { error: result.error };
    const { type, params } = result;
    if (typeof type !== 'string' || !isRecord(params))
      return fail(`result ${i}`);
    return {
      type,
      params: Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : fail(`result ${i}`),
        ]),
      ),
    };
  });
};
