// What the memory measurement of tasks 6.12 decides from its numbers, and
// the table it prints (research.md 20.10, 20.12; Req 3.14, 11.2).

/** The k8s example's memory limit (2 Gi). */
export const CONTAINER_LIMIT_MIB = 2048;
/**
 * The FastAPI service under S2, its heaviest load (research.md 20.7a). It has
 * no such figure for S1.
 */
export const PYTHON_HEAVIEST_MIB = 1230;
const PYTHON_MIB: Readonly<Record<Scenario, number | null>> = {
  S1: null,
  S2: PYTHON_HEAVIEST_MIB,
};
/** 0.95 x MAX_CHILD_RSS_MB (320). */
export const CHILD_RSS_LINE_MB = 304;
export const MIN_RUNS = 3;

export const SCENARIOS = ['S1', 'S2'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** `heldToLine: false`: measured and shown, never a failure (research.md 27.3). */
export const BASELINE_FILES = [
  { file: 'xlsx-70000-cells', heldToLine: true },
  { file: 'docx-12-images-48mb', heldToLine: true },
  { file: 'pdf-2-million-characters', heldToLine: false },
] as const;
export type BaselineFile = (typeof BASELINE_FILES)[number]['file'];

export interface LoadRun {
  readonly scenario: Scenario;
  /** Before the load, the service ready and at rest. */
  readonly idleMib: number;
  /** The highest value during the load: the idle value plus the growth. */
  readonly highestMib: number;
  /** The same without the page cache the kernel can drop; null when not known. */
  readonly workingSetHighestMib: number | null;
  /** Requests that did not end as the scenario intends. */
  readonly unexpected: readonly string[];
}

export interface BaselineMeasurement {
  readonly file: BaselineFile;
  /** One value per run; null when the service logged none. */
  readonly childPeakRssMb: readonly (number | null)[];
}

export interface Measurements {
  /** Where the numbers come from; printed with them. */
  readonly where: string;
  readonly loadRuns: readonly LoadRun[];
  readonly baselines: readonly BaselineMeasurement[];
}

export interface ExtractLogLine {
  readonly format: string;
  readonly result: string;
  readonly childPeakRssMb: number | null;
}

const EXTRACT_LINE =
  /\bextract format=(\S+) .*\bresult=(\S+) child_peak_rss_mb=(\S+)/;

/** The POST /extract lines of the service's log (src/http/request-log.ts). */
export const extractLogLines = (log: string): readonly ExtractLogLine[] =>
  log.split('\n').flatMap((line) => {
    const [, format, result, rss] = EXTRACT_LINE.exec(line) ?? [];
    if (format === undefined || result === undefined) return [];
    const childPeakRssMb = Number(rss);
    return [
      {
        format,
        result,
        childPeakRssMb: Number.isFinite(childPeakRssMb) ? childPeakRssMb : null,
      },
    ];
  });

export interface ExpectedAnswer {
  readonly fileName: string;
  readonly expectedStatus: number;
  /** Text the answer body must hold: which failure it was, not only its status. */
  readonly expectedInBody?: string;
}

/** Why an answer is not the one the load intends; none when it is. */
export const answerProblems = (
  { fileName, expectedStatus, expectedInBody }: ExpectedAnswer,
  status: number,
  body: string | null,
): readonly string[] => {
  if (status !== expectedStatus) {
    return [`${fileName}: ${status}, expected ${expectedStatus}`];
  }
  if (expectedInBody !== undefined && !(body ?? '').includes(expectedInBody)) {
    return [
      `${fileName}: ${status} without "${expectedInBody}" (${(body ?? '').slice(0, 200)})`,
    ];
  }
  return [];
};

export type RequestChildPeak =
  | { readonly state: 'waiting' }
  | { readonly state: 'found'; readonly childPeakRssMb: number | null };

/**
 * The child peak RSS of the one request sent after `linesBefore` extract
 * lines were in the log. Only a single new line that ended `ok` counts:
 * anything else is another request's value, or none.
 */
export const childPeakOfRequest = (
  linesBefore: number,
  lines: readonly ExtractLogLine[],
): RequestChildPeak => {
  const added = lines.slice(linesBefore);
  const [line] = added;
  if (line === undefined) return { state: 'waiting' };
  return {
    state: 'found',
    childPeakRssMb:
      added.length === 1 && line.result === 'ok' ? line.childPeakRssMb : null,
  };
};

const numbersOf = (values: readonly (number | null)[]): readonly number[] =>
  values.filter((value) => value !== null);

const scenarioFailures = (
  scenario: Scenario,
  runs: readonly LoadRun[],
): readonly string[] => [
  ...(runs.length < MIN_RUNS
    ? [`${scenario}: measured ${runs.length} time(s), ${MIN_RUNS} are required`]
    : []),
  ...runs.flatMap((run) => [
    ...(run.highestMib > CONTAINER_LIMIT_MIB
      ? [
          `${scenario}: ${run.highestMib} MiB is over the ${CONTAINER_LIMIT_MIB} MiB limit; the memory budget decision goes back to the user (research.md 20.10)`,
        ]
      : []),
    ...(run.unexpected.length > 0
      ? [
          `${scenario}: the load did not run as intended (${run.unexpected.join('; ')})`,
        ]
      : []),
  ]),
];

const baselineFailures = (
  { file, heldToLine }: (typeof BASELINE_FILES)[number],
  measured: BaselineMeasurement | undefined,
): readonly string[] => {
  const values = measured?.childPeakRssMb ?? [];
  const known = numbersOf(values);
  const highest = Math.max(...known);
  return [
    ...(values.length < MIN_RUNS
      ? [`${file}: measured ${values.length} time(s), ${MIN_RUNS} are required`]
      : []),
    ...(known.length < values.length
      ? [`${file}: the service logged no child peak RSS for a run`]
      : []),
    ...(heldToLine && highest > CHILD_RSS_LINE_MB
      ? [
          `${file}: the child peaked at ${highest} MB, over the ${CHILD_RSS_LINE_MB} MB line; see research.md 20.12 for what to lower (XLSX) or whom to ask (DOCX)`,
        ]
      : []),
  ];
};

/** Every reason the measurement does not meet tasks 6.12; none when it does. */
export const failuresOf = ({
  loadRuns,
  baselines,
}: Measurements): readonly string[] => [
  ...SCENARIOS.flatMap((scenario) =>
    scenarioFailures(
      scenario,
      loadRuns.filter((run) => run.scenario === scenario),
    ),
  ),
  ...BASELINE_FILES.flatMap((entry) =>
    baselineFailures(
      entry,
      baselines.find((measured) => measured.file === entry.file),
    ),
  ),
];

const signed = (value: number): string =>
  value > 0 ? `+${value}` : String(value);

const rangeOf = (values: readonly number[]): string =>
  values.length === 0 ? '-' : `${Math.min(...values)} - ${Math.max(...values)}`;

const scenarioRow = (scenario: Scenario, runs: readonly LoadRun[]): string => {
  const highest = runs.map((run) => run.highestMib);
  const top = Math.max(...highest);
  const python = PYTHON_MIB[scenario];
  const workingSets = numbersOf(runs.map((run) => run.workingSetHighestMib));
  return `| ${scenario} | ${runs.length} | ${rangeOf(runs.map((run) => run.idleMib))} | ${rangeOf(highest)} | ${rangeOf(workingSets)} | ${runs.length === 0 ? '-' : top} | ${runs.length === 0 || python === null ? '-' : signed(top - python)} | ${runs.length === 0 ? '-' : CONTAINER_LIMIT_MIB - top} |`;
};

const baselineRow = (
  { file, heldToLine }: (typeof BASELINE_FILES)[number],
  measured: BaselineMeasurement | undefined,
): string => {
  const known = numbersOf(measured?.childPeakRssMb ?? []);
  return `| ${file} | ${measured?.childPeakRssMb.length ?? 0} | ${rangeOf(known)} | ${heldToLine ? CHILD_RSS_LINE_MB : 'not held to the line'} |`;
};

export const toMarkdown = (measured: Measurements): string => {
  const failures = failuresOf(measured);
  return [
    `Measured: ${measured.where}`,
    '',
    `Heaviest loads, MiB (limit ${CONTAINER_LIMIT_MIB}; Python under S2: ${PYTHON_HEAVIEST_MIB}):`,
    '',
    '| scenario | runs | idle | highest (idle + growth) | highest without droppable page cache | highest of all runs | against Python | room under the limit |',
    '|---|---|---|---|---|---|---|---|',
    ...SCENARIOS.map((scenario) =>
      scenarioRow(
        scenario,
        measured.loadRuns.filter((run) => run.scenario === scenario),
      ),
    ),
    '',
    'Child peak RSS, MB:',
    '',
    '| file | runs | lowest - highest | line |',
    '|---|---|---|---|',
    ...BASELINE_FILES.map((entry) =>
      baselineRow(
        entry,
        measured.baselines.find((found) => found.file === entry.file),
      ),
    ),
    '',
    failures.length === 0
      ? 'Result: within the limits.'
      : `Result: NOT met.\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
    '',
  ].join('\n');
};
