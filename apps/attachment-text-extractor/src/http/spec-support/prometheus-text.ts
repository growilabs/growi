// Reads the Prometheus text exposition GET /metrics serves, so a test asserts
// on a series by name and label set, whatever order the labels are written in.

export interface Sample {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

export interface Exposition {
  /** The name of every `# TYPE` line, with its type. */
  readonly types: ReadonlyMap<string, string>;
  readonly samples: readonly Sample[];
}

const SAMPLE = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})? (\S+)$/;
const LABEL = /([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
const TYPE = /^# TYPE (\S+) (\S+)$/;

const labelsOf = (text: string): Record<string, string> =>
  Object.fromEntries(
    [...text.matchAll(LABEL)].map(([, key = '', value = '']) => [
      key,
      value.replace(/\\(.)/g, (_, escaped: string) =>
        escaped === 'n' ? '\n' : escaped,
      ),
    ]),
  );

const numberOf = (text: string): number =>
  text === '+Inf' ? Infinity : text === '-Inf' ? -Infinity : Number(text);

export const parseExposition = (text: string): Exposition => {
  const types = new Map<string, string>();
  const samples: Sample[] = [];
  for (const line of text.split('\n')) {
    const type = TYPE.exec(line);
    if (type !== null) {
      types.set(type[1] ?? '', type[2] ?? '');
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    const sample = SAMPLE.exec(line);
    if (sample === null) throw new Error(`not a sample line: ${line}`);
    samples.push({
      name: sample[1] ?? '',
      labels: labelsOf(sample[2] ?? ''),
      value: numberOf(sample[3] ?? ''),
    });
  }
  return { types, samples };
};

const sameLabels = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([key, value]) => b[key] === value);

/** The value of the series with exactly these labels; undefined when absent. */
export const seriesValue = (
  exposition: Exposition,
  name: string,
  labels: Readonly<Record<string, string>> = {},
): number | undefined =>
  exposition.samples.find(
    (sample) => sample.name === name && sameLabels(sample.labels, labels),
  )?.value;

/** Every series of `name`, as its labels. */
export const seriesLabels = (
  exposition: Exposition,
  name: string,
): readonly Readonly<Record<string, string>>[] =>
  exposition.samples
    .filter((sample) => sample.name === name)
    .map((sample) => sample.labels);
