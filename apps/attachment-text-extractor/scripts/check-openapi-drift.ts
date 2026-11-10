type JsonObject = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const escaped = (key: string): string =>
  key.replaceAll('~', '~0').replaceAll('/', '~1');

const differences = (
  actual: unknown,
  committed: unknown,
  pointer: string,
): readonly string[] => {
  if (Array.isArray(actual) && Array.isArray(committed)) {
    return actual.length === committed.length
      ? actual.flatMap((item, index) =>
          differences(item, committed[index], `${pointer}/${index}`),
        )
      : [pointer];
  }
  if (isObject(actual) && isObject(committed)) {
    const keys = [
      ...new Set([...Object.keys(actual), ...Object.keys(committed)]),
    ].toSorted();
    return keys.flatMap((key) => {
      const at = `${pointer}/${escaped(key)}`;
      return key in actual && key in committed
        ? differences(actual[key], committed[key], at)
        : [at];
    });
  }
  return actual === committed ? [] : [pointer];
};

/**
 * The JSON Pointers where two parsed JSON documents differ (none when they
 * are equal): object keys in any order, arrays in order.
 */
export const openApiDrift = (
  actual: unknown,
  committed: unknown,
): readonly string[] => differences(actual, committed, '');
