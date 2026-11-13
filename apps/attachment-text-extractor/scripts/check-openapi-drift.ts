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

const USAGE = 'usage: check-openapi-drift.ts <actual.json> <committed.json>\n';

// CLI: exits 0 when the two files hold the same JSON, 1 when they differ
// (the pointers go to stderr), 2 when they cannot be compared at all.
const main = async (args: readonly string[]): Promise<number> => {
  const { readFileSync } = await import('node:fs');
  const [actual, committed] = args;
  if (actual === undefined || committed === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }
  const parsed = (file: string): unknown =>
    JSON.parse(readFileSync(file, 'utf8'));
  try {
    const drift = openApiDrift(parsed(actual), parsed(committed));
    if (drift.length === 0) return 0;
    process.stderr.write(
      `${actual} and ${committed} differ at:\n${drift.map((pointer) => `  ${pointer === '' ? '(the whole document)' : pointer}`).join('\n')}\n`,
    );
    return 1;
  } catch (error) {
    process.stderr.write(
      `cannot compare: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
};

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
