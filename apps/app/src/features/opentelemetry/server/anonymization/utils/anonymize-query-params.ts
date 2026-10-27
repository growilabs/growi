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

  const targets = new Set(paramNames);
  let changed = false;

  const pairs = search.split('&').map((pair) => {
    if (pair === '') {
      return pair;
    }
    const eq = pair.indexOf('=');
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const name = decodeQueryComponent(rawName).replace(/\[\]$/, '');
    if (!targets.has(name)) {
      return pair;
    }
    changed = true;
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    return `${rawName}=${replacementFor(rawValue)}`;
  });

  return changed ? pairs.join('&') : search;
};
