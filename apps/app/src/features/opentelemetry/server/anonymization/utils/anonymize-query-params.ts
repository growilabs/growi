/**
 * Try to parse JSON array, return null if invalid
 */
function tryParseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const ANONYMIZED_VALUE = '%5BANONYMIZED%5D';
const ANONYMIZED_JSON_ARRAY_VALUE = '%5B%22%5BANONYMIZED%5D%22%5D';

const decodeQueryComponent = (raw: string): string => {
  const withSpaces = raw.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
};

const replacementFor = (rawValue: string): string => {
  const value = decodeQueryComponent(rawValue);
  if (value.startsWith('[') && value.endsWith(']')) {
    const jsonArray = tryParseJsonArray(value);
    if (jsonArray != null && jsonArray.length > 0) {
      return ANONYMIZED_JSON_ARRAY_VALUE;
    }
  }
  return ANONYMIZED_VALUE;
};

const PERCENT = 0x25;
const PLUS = 0x2b;
const EQUALS = 0x3d;
const OPEN_BRACKET = 0x5b;

type Targets = {
  readonly names: ReadonlySet<string>;
  /** The targets by the first character of the raw name that can match them */
  readonly byFirstChar: ReadonlyMap<number, readonly string[]>;
};

// Runs on every incoming request, so the lookup is built once per rules list.
// Keyed by array identity: a list must not be mutated after it is first passed in.
const targetsCache = new WeakMap<readonly string[], Targets>();

const buildTargets = (paramNames: readonly string[]): Targets => {
  const byFirstChar = new Map<number, string[]>();
  const add = (code: number, name: string): void => {
    byFirstChar.set(code, [...(byFirstChar.get(code) ?? []), name]);
  };
  for (const name of paramNames) {
    if (name === '') {
      // An empty name is matched by `=x` and by `[...]=x`
      add(EQUALS, name);
      add(OPEN_BRACKET, name);
    } else {
      add(name.charCodeAt(0), name);
    }
  }
  return { names: new Set(paramNames), byFirstChar };
};

const targetsOf = (paramNames: readonly string[]): Targets => {
  const cached = targetsCache.get(paramNames);
  if (cached != null) {
    return cached;
  }
  const targets = buildTargets(paramNames);
  targetsCache.set(paramNames, targets);
  return targets;
};

/** The decoded name, cut at the first `[` (qs serializes name[], name[0], name[a][0]) */
const decodedNameOf = (rawName: string): string => {
  const decoded = decodeQueryComponent(rawName);
  const bracket = decoded.indexOf('[');
  return bracket === -1 ? decoded : decoded.slice(0, bracket);
};

/** The first `=` in `search[from, end)`, or `end`; bounded so the scan stays linear */
const equalsOrEnd = (search: string, from: number, end: number): number => {
  for (let i = from; i < end; i++) {
    if (search.charCodeAt(i) === EQUALS) {
      return i;
    }
  }
  return end;
};

const isCandidateAt = (
  candidates: readonly string[] | undefined,
  search: string,
  start: number,
  stop: number,
): boolean => {
  if (candidates == null) {
    return false;
  }
  const length = stop - start;
  for (const name of candidates) {
    if (name.length === length && search.startsWith(name, start)) {
      return true;
    }
  }
  return false;
};

/**
 * Match the name of the pair `search[start, end)` against the targets.
 * A raw name with no `%` or `+` before its first `[` decodes to itself up to
 * that `[`, so it is compared in place, and a pair whose first character no
 * target starts with is rejected without scanning it.
 * @returns The end of the raw name when the pair is targeted, otherwise -1
 */
const targetedNameEnd = (
  search: string,
  start: number,
  end: number,
  targets: Targets,
): number => {
  const first = search.charCodeAt(start);
  const candidates = targets.byFirstChar.get(first);
  if (candidates == null && first !== PERCENT && first !== PLUS) {
    return -1;
  }
  for (let i = start; i < end; i++) {
    const code = search.charCodeAt(i);
    if (code === EQUALS || code === OPEN_BRACKET) {
      if (!isCandidateAt(candidates, search, start, i)) {
        return -1;
      }
      return code === EQUALS ? i : equalsOrEnd(search, i, end);
    }
    if (code === PERCENT || code === PLUS) {
      const nameEnd = equalsOrEnd(search, i, end);
      const name = decodedNameOf(search.slice(start, nameEnd));
      return targets.names.has(name) ? nameEnd : -1;
    }
  }
  return isCandidateAt(candidates, search, start, end) ? end : -1;
};

/**
 * Replace the values of the named parameters in a raw query string (no leading `?`).
 * Pairs whose name is not targeted are returned byte-for-byte (no re-encoding).
 */
export const anonymizeQueryParams = (
  search: string,
  paramNames: readonly string[],
): string => {
  if (search === '' || paramNames.length === 0) {
    return search;
  }

  const targets = targetsOf(paramNames);
  let result = '';
  // End of the part of `search` already copied into `result`
  let copied = 0;

  let start = 0;
  while (start <= search.length) {
    const amp = search.indexOf('&', start);
    const end = amp === -1 ? search.length : amp;

    const nameEnd =
      end > start ? targetedNameEnd(search, start, end, targets) : -1;
    if (nameEnd !== -1) {
      const rawValue = nameEnd === end ? '' : search.slice(nameEnd + 1, end);
      result += `${search.slice(copied, nameEnd)}=${replacementFor(rawValue)}`;
      copied = end;
    }

    if (amp === -1) {
      break;
    }
    start = amp + 1;
  }

  return copied === 0 ? search : result + search.slice(copied);
};
