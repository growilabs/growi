/**
 * Reading facts out of one CI job log: vitest failure blocks, Playwright
 * `::error` annotations, a Playwright shard's own count summary, and each
 * Playwright run's end-of-run summary with its flaky and failed test lists.
 *
 * This replaces the literal-pattern greps `detect-flaky-ci/SKILL.md` Step 2
 * and Step 3 used to spell out (`FAIL `, `::error`, ` flaky`, and
 * `grep -E '[0-9]+ (failed|flaky|passed|skipped)'`). Everything here is a
 * fact; which tier an identity gets, which failures fold into one identity,
 * and whether a denylist hit drops a failure or the whole job all stay in the
 * procedure.
 *
 * Every function normalizes its input with `ansi.strip` first (which is
 * idempotent), so a caller may hand over either a raw log or an already
 * stripped one. Timestamps are deliberately **not** removed from the text:
 * they are part of the evidence excerpt a tracking issue quotes. Instead,
 * every pattern here is position-independent — the endpoint prefixes each
 * line with `2026-09-14T09:22:51.3976078Z `, and Playwright prints an
 * annotation mid-line, so a line-start anchor matches nothing (measured in
 * the procedure: anchored `error file=`, 0 matches; unanchored, 1).
 */
import { strip } from './ansi.ts';

export type FailBlock = {
  /** The vitest project tag (`app-unit`, `app-integration`, …), if printed. */
  readonly project: string | null;
  /** The failing spec file's path, exactly as the reporter printed it. */
  readonly specPath: string;
  /**
   * The suite-and-test part of the FAIL line, with ` > ` separators kept as
   * printed — `null` for a file-level FAIL line (`FAIL app-integration
   * some.integ.ts [ some.integ.ts ]`), which names no test at all.
   */
  readonly testTitle: string | null;
  /** True when this block's own stack frame resolves under `test/setup/`. */
  readonly sharedSetupHook: boolean;
  /** The FAIL line plus the error and stack lines printed under it. */
  readonly excerpt: string;
};

export type PlaywrightAnnotation = {
  readonly file: string | null;
  /** `null` when the annotation carries no `title=` — tier 2's third case. */
  readonly title: string | null;
};

export type Summary = {
  readonly failed: number;
  readonly flaky: number;
  readonly passed: number;
  readonly skipped: number;
};

/** The `2026-09-14T09:22:51.3976078Z ` the log endpoint puts on every line. */
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /;

const withoutTimestamp = (line: string): string =>
  line.replace(TIMESTAMP_PREFIX, '');

/**
 * A token that names a test file. The three suffixes are the ones this repo's
 * vitest projects use; requiring one is what separates a vitest failure block
 * from the plain `FAIL <something>` lines other tools print into the same log
 * (the i18n-audit tool's `FAIL unused-key count 80 exceeds baseline 10` is a
 * real example in `fixtures/job-logs/ci-app-test-100952911197-excerpt.txt`),
 * which the procedure's `grep 'FAIL '` could not tell apart.
 */
const SPEC_PATH_TOKEN = /\.(spec|integ|test)\.[cm]?[jt]sx?$/;

/** The FAIL marker, wherever it sits on the line. */
const FAIL_MARKER = /(?:^|\s)FAIL\s+(.+)$/;

/** Vitest's `⎯⎯⎯[1/8]⎯` divider between two reported failures. */
const FAILURE_DIVIDER = /⎯.*\[\d+\/\d+\]/;

/** Vitest's own run totals, which end the last block's error output. */
const VITEST_TOTALS = /^\s*(Test Files|Tests|Start at|Duration|Errors)\s/;

/**
 * A last-resort bound on a block's excerpt, for a log where none of the three
 * terminators above appears after the last failure. Without it the excerpt
 * would run to the end of the text and could pick up a denylist string from a
 * completely unrelated part of the log — the per-job-not-per-failure mistake
 * the procedure warns about, which would drop a real flake as infra noise.
 *
 * Measured before choosing the number, so that it never clips a genuine
 * block (clipping loses the tail, which is where the stack frames are — a
 * `test/setup/` frame or a denylist needle past the cut would go unseen):
 * the five real failures in the whole 517 KiB `ci-app-test` job log run 13–14
 * lines each, and the longest single failure in any fixture here is 37 lines
 * (`11914-playwright-flaky-excerpt.txt`). 120 leaves room for a long code
 * frame and an `Unhandled Errors` section on top of that, and is still far
 * short of the hundreds of runner lines that follow a job's output.
 */
const MAX_EXCERPT_LINES = 120;

type FailLine = {
  readonly index: number;
  readonly project: string | null;
  readonly specPath: string;
  readonly testTitle: string | null;
};

/** Parses one line as a vitest FAIL block header, or returns `null`. */
const parseFailLine = (line: string): Omit<FailLine, 'index'> | null => {
  const marker = withoutTimestamp(line).match(FAIL_MARKER);
  if (marker?.[1] == null) {
    return null;
  }
  const segments = marker[1].split(' > ');
  const head = segments[0] ?? '';
  const tokens = head.split(/\s+/).filter((token) => token !== '');
  const pathIndex = tokens.findIndex((token) => SPEC_PATH_TOKEN.test(token));
  if (pathIndex === -1) {
    return null;
  }
  const project = pathIndex === 0 ? null : tokens.slice(0, pathIndex).join(' ');
  const rest = segments.slice(1).join(' > ').trim();
  return {
    project,
    specPath: tokens[pathIndex] as string,
    testTitle: rest === '' ? null : rest,
  };
};

/** A stack frame under `test/setup/` — the shared setup-hook discriminator. */
const SETUP_FRAME = /(?:^|[\s(])test\/setup\/[^\s:]+/;

/**
 * Whether a failure's own excerpt carries a stack frame resolving under
 * `test/setup/`. This is the discriminator the procedure spells out: the
 * frame printed under the error, not the FAIL line, is what tells a shared
 * setup hook from a spec file's own `beforeAll`. Collapsing such failures
 * into one identity remains the procedure's judgment.
 */
export const isSharedSetupHookBlock = (block: string): boolean =>
  strip(block)
    .split('\n')
    .map(withoutTimestamp)
    .some((line) => SETUP_FRAME.test(line));

/**
 * Every vitest failure block in the log, in the order printed. A block runs
 * from its FAIL line to whichever comes first: the next FAIL line, vitest's
 * `[n/m]` divider, its run totals, or `MAX_EXCERPT_LINES`.
 */
export const extractFailBlocks = (text: string): readonly FailBlock[] => {
  const lines = strip(text).split('\n');

  const failLines: FailLine[] = [];
  lines.forEach((line, index) => {
    const parsed = parseFailLine(line);
    if (parsed != null) {
      failLines.push({ ...parsed, index });
    }
  });

  return failLines.map((failLine, position) => {
    const nextFailIndex = failLines[position + 1]?.index ?? lines.length;
    const hardLimit = Math.min(
      nextFailIndex,
      failLine.index + MAX_EXCERPT_LINES,
      lines.length,
    );
    let end = hardLimit;
    for (let i = failLine.index + 1; i < hardLimit; i += 1) {
      const line = withoutTimestamp(lines[i] as string);
      if (FAILURE_DIVIDER.test(line) || VITEST_TOTALS.test(line)) {
        end = i;
        break;
      }
    }
    const excerpt = lines.slice(failLine.index, end).join('\n');
    return {
      project: failLine.project,
      specPath: failLine.specPath,
      testTitle: failLine.testTitle,
      sharedSetupHook: isSharedSetupHookBlock(excerpt),
      excerpt,
    };
  });
};

/**
 * Only the `::error ` spelling is matched, deliberately. The runner echoes
 * some workflow commands in `##[…]` form (real example: `##[notice]  1 flaky`
 * in `fixtures/job-logs/11914-playwright-flaky-excerpt.txt`), but no material
 * collected for this spec contains an error annotation in that form, so
 * accepting one would be guesswork — and guesswork with a cost: if a log ever
 * carried both spellings of one annotation, the procedure's tier-1 rule
 * ("exactly one **distinct** annotation") would see two and drop to the
 * coarse identity. The failure mode of not matching a form that does exist is
 * the safer one: zero annotations also sends the procedure to the coarse
 * identity, and never to a precise-but-wrong one.
 */
const ANNOTATION_MARKER = '::error ';
/** `file=` runs until the next known key, so a value may contain `,`. */
const ANNOTATION_FILE =
  /(?:^|,)file=(.*?)(?=,(?:title|line|col|endLine|endColumn)=|$)/;
const ANNOTATION_TITLE =
  /(?:^|,)title=(.*?)(?=,(?:line|col|endLine|endColumn)=|$)/;

/**
 * Every `::error file=…,title=…` annotation, in the order printed and with
 * repeats kept: the procedure's tier-1 rule counts **distinct** annotations,
 * so it has to see the repeats rather than be handed a deduplicated list.
 * The raw values are returned unchanged — normalizing them into an identity
 * key (dropping `apps/app/`, the `[browser] › file:line:col › ` prefix, and
 * rewriting ` › `) belongs to the identity step, not here.
 */
export const extractPlaywrightAnnotations = (
  text: string,
): readonly PlaywrightAnnotation[] => {
  const annotations: PlaywrightAnnotation[] = [];
  for (const line of strip(text).split('\n')) {
    let searchFrom = 0;
    for (;;) {
      const start = line.indexOf(ANNOTATION_MARKER, searchFrom);
      if (start === -1) {
        break;
      }
      const paramsStart = start + ANNOTATION_MARKER.length;
      // The annotation's parameters end at the `::` that starts its message.
      const paramsEnd = line.indexOf('::', paramsStart);
      const params =
        paramsEnd === -1
          ? line.slice(paramsStart)
          : line.slice(paramsStart, paramsEnd);
      annotations.push({
        file: params.match(ANNOTATION_FILE)?.[1] ?? null,
        title: params.match(ANNOTATION_TITLE)?.[1] ?? null,
      });
      searchFrom = paramsEnd === -1 ? line.length : paramsEnd + 2;
    }
  }
  return annotations;
};

const SUMMARY_KEYS = ['failed', 'flaky', 'passed', 'skipped'] as const;
type SummaryKey = (typeof SUMMARY_KEYS)[number];

/**
 * A Playwright shard's count line: the number starts the line (after the
 * timestamp), as in `  1 flaky` / `  106 passed (5.7m)`. The anchor is what
 * keeps vitest's own totals out — ` Test Files  1 failed | 309 passed (310)`
 * starts with a word, so it never matches, and reading it as a shard summary
 * would fire the tier-1 count test on a vitest job.
 */
const SUMMARY_LINE = /^\s*(\d+)\s+(failed|flaky|passed|skipped)\b/;

/**
 * The shard's summary counts, or `null` when the log carries no count line at
 * all. The distinction matters: `null` means "not measured" and sends the
 * procedure to its coarse identity, while a captured summary with an absent
 * line legitimately reads that line as `0` (a shard with no failures prints
 * no `failed` line).
 *
 * The **first** occurrence of each keyword wins. The runner echoes the whole
 * summary a second time under `##[notice]` (real example:
 * `fixtures/job-logs/11914-playwright-flaky-excerpt.txt`), and adding the
 * echo to the first reading would double every count.
 */
export const extractSummary = (text: string): Summary | null => {
  const counts = new Map<SummaryKey, number>();
  for (const rawLine of strip(text).split('\n')) {
    const found = withoutTimestamp(rawLine).match(SUMMARY_LINE);
    const key = found?.[2] as SummaryKey | undefined;
    if (found?.[1] == null || key == null || counts.has(key)) {
      continue;
    }
    counts.set(key, Number.parseInt(found[1], 10));
  }
  if (counts.size === 0) {
    return null;
  }
  return {
    failed: counts.get('failed') ?? 0,
    flaky: counts.get('flaky') ?? 0,
    passed: counts.get('passed') ?? 0,
    skipped: counts.get('skipped') ?? 0,
  };
};

export type PlaywrightListedTest = {
  /** The project name printed between `[` and `]`, e.g. `firefox/guest-mode`. */
  readonly project: string;
  /** The spec path without its `:line:col`. */
  readonly specPath: string;
  /** The group names and the test name, joined with ` > `. */
  readonly testTitle: string;
};

export type PlaywrightTestList =
  | { readonly kind: 'read'; readonly tests: readonly PlaywrightListedTest[] }
  | {
      readonly kind: 'unreadable';
      /**
       * `count-mismatch`: the heading's count differs from the number of test
       * lines under it. `malformed-entry`: a line under it is not a full
       * `[project] › path:line:col › title` line.
       */
      readonly reason: 'count-mismatch' | 'malformed-entry';
    };

export type PlaywrightRun = {
  readonly counts: Summary;
  readonly flaky: PlaywrightTestList;
  readonly failed: PlaywrightTestList;
  /** The lines read as this run's summary, timestamps kept, in printed order. */
  readonly excerpt: string;
};

const TITLE_SEPARATOR = ' › ';
const PROJECT_SEGMENT = /^\[([^\]]+)\]$/;
const POSITIONED_SPEC_PATH = /^(.+):\d+:\d+$/;

/**
 * Splits one `[project] › path:line:col › group › … › test` line, or returns
 * `null` when the line does not have that full shape. A ` › ` inside a title
 * cannot be told apart from the separator Playwright prints between titles,
 * so it becomes ` > ` like any other boundary.
 */
export const parsePlaywrightTestLine = (
  line: string,
): PlaywrightListedTest | null => {
  const [projectSegment, positionedPath, ...titles] = line
    .trim()
    .split(TITLE_SEPARATOR);
  const project = projectSegment?.match(PROJECT_SEGMENT)?.[1];
  const specPath = positionedPath?.match(POSITIONED_SPEC_PATH)?.[1];
  if (project == null || specPath == null || titles.length === 0) {
    return null;
  }
  return { project, specPath, testTitle: titles.join(' > ') };
};

const RUN_COUNT_KEYWORDS = [
  'failed',
  'flaky',
  'interrupted',
  'skipped',
  'did not run',
  'passed',
] as const;
type RunCountKeyword = (typeof RUN_COUNT_KEYWORDS)[number];

/**
 * Anchored on the leading number, so vitest's totals
 * (` Test Files  1 failed | 309 passed (310)`) never match. `interrupted` and
 * `did not run` are read only so that they do not end a summary.
 */
const RUN_COUNT_LINE = new RegExp(
  `^\\s*(\\d+)\\s+(${RUN_COUNT_KEYWORDS.join('|')})\\b`,
);
const NOTICE_PREFIX = '##[notice]';
/**
 * Deliberately looser than `parsePlaywrightTestLine`: a list line with a
 * broken shape must still stay inside its list, so that the list comes back
 * as `malformed-entry` rather than as a count mismatch.
 */
const LISTED_TEST_START = /^\s*\[[^\]]+\] › /;

type LineKind = 'count' | 'echoed-count' | 'listed-test' | 'other';

const classifyLine = (body: string): LineKind => {
  if (RUN_COUNT_LINE.test(body)) {
    return 'count';
  }
  if (
    body.startsWith(NOTICE_PREFIX) &&
    RUN_COUNT_LINE.test(body.slice(NOTICE_PREFIX.length))
  ) {
    return 'echoed-count';
  }
  return LISTED_TEST_START.test(body) ? 'listed-test' : 'other';
};

type SummaryRange = {
  /** The runner's `##[notice]` re-print of a summary, never read. */
  readonly echoed: boolean;
  readonly lines: readonly string[];
};

/**
 * Groups the text into summary ranges: a count line (plain or echoed) opens
 * one, count and listed-test lines continue it, any other line closes it. An
 * echoed count line always opens a new range, so an echo printed right after
 * a summary never extends that summary.
 */
const collectSummaryRanges = (
  lines: readonly string[],
): readonly SummaryRange[] => {
  const ranges: SummaryRange[] = [];
  let open: { echoed: boolean; lines: string[] } | null = null;
  for (const line of lines) {
    const kind = classifyLine(withoutTimestamp(line));
    if (kind === 'count' || kind === 'echoed-count') {
      if (open == null || kind === 'echoed-count') {
        if (open != null) {
          ranges.push(open);
        }
        open = { echoed: kind === 'echoed-count', lines: [] };
      }
      open.lines.push(line);
    } else if (kind === 'listed-test' && open != null) {
      open.lines.push(line);
    } else if (open != null) {
      ranges.push(open);
      open = null;
    }
  }
  if (open != null) {
    ranges.push(open);
  }
  return ranges;
};

const toTestList = (
  count: number,
  entries: readonly string[],
): PlaywrightTestList => {
  const parsed = entries.map(parsePlaywrightTestLine);
  const tests = parsed.filter(
    (test): test is PlaywrightListedTest => test != null,
  );
  if (tests.length !== parsed.length) {
    return { kind: 'unreadable', reason: 'malformed-entry' };
  }
  if (tests.length !== count) {
    return { kind: 'unreadable', reason: 'count-mismatch' };
  }
  return { kind: 'read', tests };
};

/** Reads one summary range: each listed-test line belongs to the count line above it. */
const readRun = (range: SummaryRange): PlaywrightRun => {
  const counts = new Map<RunCountKeyword, number>();
  const entries = new Map<RunCountKeyword, string[]>();
  let heading: RunCountKeyword | null = null;
  for (const line of range.lines) {
    const body = withoutTimestamp(line);
    const found = body.match(RUN_COUNT_LINE);
    if (found?.[1] != null && found[2] != null) {
      heading = found[2] as RunCountKeyword;
      counts.set(heading, Number.parseInt(found[1], 10));
    } else if (heading != null) {
      entries.set(heading, [...(entries.get(heading) ?? []), body]);
    }
  }
  const listFor = (keyword: 'failed' | 'flaky'): PlaywrightTestList =>
    toTestList(counts.get(keyword) ?? 0, entries.get(keyword) ?? []);
  return {
    counts: {
      failed: counts.get('failed') ?? 0,
      flaky: counts.get('flaky') ?? 0,
      passed: counts.get('passed') ?? 0,
      skipped: counts.get('skipped') ?? 0,
    },
    flaky: listFor('flaky'),
    failed: listFor('failed'),
    excerpt: range.lines.join('\n'),
  };
};

/**
 * Every Playwright run's end-of-run summary in the log, in printed order, with
 * its `failed` and `flaky` test lists — an empty array when the log carries no
 * summary at all. The `##[notice]` echo of a summary is dropped as a whole.
 * Nothing is guessed: a list that does not read cleanly comes back as
 * `unreadable` with its reason.
 */
export const extractPlaywrightRuns = (text: string): readonly PlaywrightRun[] =>
  collectSummaryRanges(strip(text).split('\n'))
    .filter((range) => !range.echoed)
    .map(readRun);
