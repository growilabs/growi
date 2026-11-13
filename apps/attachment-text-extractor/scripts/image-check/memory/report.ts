// What the memory measurement of tasks 6.12 decides from its numbers, and
// the table it prints (research.md 20.10, 20.12; Req 3.14, 11.2).

/** The memory limit the service is designed for (2 Gi; docker/README.md). */
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
/**
 * 0.95 x MAX_CHILD_RSS_MB (320). Crossing it is a warning, not a failure: the
 * baseline files sit 10 - 30 MB under it, less than machines differ by.
 */
export const CHILD_RSS_LINE_MB = 304;
export const MIN_RUNS = 3;

export const SCENARIOS = ['S1', 'S2'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** `heldToLine: false`: measured and shown, never a warning (research.md 27.3). */
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
  { file }: (typeof BASELINE_FILES)[number],
  measured: BaselineMeasurement | undefined,
): readonly string[] => {
  const values = measured?.childPeakRssMb ?? [];
  const known = numbersOf(values);
  return [
    ...(values.length < MIN_RUNS
      ? [`${file}: measured ${values.length} time(s), ${MIN_RUNS} are required`]
      : []),
    ...(known.length < values.length
      ? [`${file}: the service logged no child peak RSS for a run`]
      : []),
  ];
};

/** How far the highest known child peak is over the line; 0 when it is not, or the file is not held to it. */
const overLineMb = (
  { heldToLine }: (typeof BASELINE_FILES)[number],
  measured: BaselineMeasurement | undefined,
): number =>
  heldToLine
    ? Math.max(
        0,
        ...numbersOf(measured?.childPeakRssMb ?? []).map(
          (value) => value - CHILD_RSS_LINE_MB,
        ),
      )
    : 0;

/**
 * Every reason the check fails: a heaviest load over the limit, or a
 * measurement that is not valid (too few runs, an unintended answer, a
 * missing value). None when it passes.
 */
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

/**
 * What to look at although the check passes: a baseline file whose child
 * went over the line. One line each.
 */
export const warningsOf = ({ baselines }: Measurements): readonly string[] =>
  BASELINE_FILES.flatMap((entry) => {
    const over = overLineMb(
      entry,
      baselines.find((measured) => measured.file === entry.file),
    );
    return over > 0
      ? [
          `${entry.file}: the child peaked at ${CHILD_RSS_LINE_MB + over} MB, over the ${CHILD_RSS_LINE_MB} MB line; see research.md 20.12 for what to lower (XLSX) or whom to ask (DOCX)`,
        ]
      : [];
  });

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
  entry: (typeof BASELINE_FILES)[number],
  measured: BaselineMeasurement | undefined,
): string => {
  const known = numbersOf(measured?.childPeakRssMb ?? []);
  const over = overLineMb(entry, measured);
  return `| ${entry.file} | ${measured?.childPeakRssMb.length ?? 0} | ${rangeOf(known)} | ${entry.heldToLine ? CHILD_RSS_LINE_MB : 'not held to the line'} | ${over > 0 ? `**OVER by ${over} MB (warning)**` : '-'} |`;
};

const bullets = (lines: readonly string[]): string =>
  lines.map((line) => `- ${line}`).join('\n');

export const toMarkdown = (measured: Measurements): string => {
  const failures = failuresOf(measured);
  const warnings = warningsOf(measured);
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
    '| file | runs | lowest - highest | line | against the line |',
    '|---|---|---|---|---|',
    ...BASELINE_FILES.map((entry) =>
      baselineRow(
        entry,
        measured.baselines.find((found) => found.file === entry.file),
      ),
    ),
    '',
    failures.length === 0
      ? `Result: within the ${warnings.length === 0 ? 'limits' : `${CONTAINER_LIMIT_MIB} MiB limit`}.`
      : `Result: NOT met.\n${bullets(failures)}`,
    ...(warnings.length === 0
      ? []
      : ['', `WARNING (does not fail the check):\n${bullets(warnings)}`]),
    '',
  ].join('\n');
};
