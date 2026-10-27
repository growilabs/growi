#!/usr/bin/env node
/**
 * Reads, for one or more flaky-tracking issues that carry (or carried)
 * `flaky/needs-decision`, the row `flaky-ci-routine.md` Step 5's
 * `## Awaiting human decision` section prints: when the label was last
 * applied, the pinned recommendation line from the pause comment (or a
 * widened, possibly-stale one), and how many observation comments have
 * landed since.
 *
 * Replaces the `PAUSED_AT` computation duplicated from Step 2-B and the
 * Recommendation-cell search that used to appear in Step 5 items 2-3.
 *
 * Usage: node awaiting-decision-rows.ts --issue <number> [--issue <number> …]
 *
 * Output fields (exit 0): rows[] — one per --issue, each with pausedAt
 * (ISO-8601 UTC or null), pausedAtStatus ("ok" or "unavailable"),
 * recommendation (string or null), recommendationSource ("in-window",
 * "widened" or "none"), newObservations (number or null).
 * Exit 2: no --issue was given (nothing to build even one row from).
 *
 * Per the multi-row convention (design.md Error Handling): a single issue
 * whose label-add time cannot be read gets pausedAtStatus "unavailable" on
 * its own row, and the overall result still reports ok:true — one
 * unreadable issue must not hide every other row.
 */
import { pathToFileURL } from 'node:url';

import {
  COMMENT_HEADINGS,
  LABELS,
  MARKERS,
  PAUSE_WINDOW_SECONDS,
  SIGNATURES,
} from '../lib/constants.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult, UNAVAILABLE } from '../lib/output.ts';
import { compareIso, minusSeconds } from '../lib/time.ts';

const HELP = `Usage: node awaiting-decision-rows.ts --issue <number> [--issue <number> …]

Reads, per issue, the newest flaky/needs-decision label-add time, the
- Recommendation: line from the automated comment that pins it, and the
number of observation comments landed since.

Output fields (exit 0): rows[] — pausedAt, pausedAtStatus ("ok" or
"unavailable"), recommendation, recommendationSource ("in-window",
"widened" or "none"), newObservations
Exit code 2: no --issue was given
`;

export type CliArgs = { readonly issues: readonly string[] };

export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'args'; readonly value: CliArgs }
  | { readonly kind: 'invalid'; readonly reason: string };

const flagValues = (argv: readonly string[], name: string): string[] => {
  const values: string[] = [];
  const flag = `--${name}`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (value != null) {
        values.push(value);
      }
    }
  }
  return values;
};

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  const issues = flagValues(argv, 'issue');
  if (issues.length === 0) {
    return { kind: 'invalid', reason: 'at least one --issue is required' };
  }
  return { kind: 'args', value: { issues } };
};

type LabeledEvent = {
  readonly event: string;
  readonly created_at: string;
  readonly label?: { readonly name: string };
};

type Comment = {
  readonly id: number;
  readonly created_at: string;
  readonly body: string;
  readonly user: { readonly type: string };
};

export type RecommendationSource = 'in-window' | 'widened' | 'none';

export type Row = {
  readonly issue: string;
  readonly pausedAt: string | null;
  readonly pausedAtStatus: 'ok' | typeof UNAVAILABLE;
  readonly recommendation: string | null;
  readonly recommendationSource: RecommendationSource;
  readonly newObservations: number | null;
};

/** First `- Date:` (the leading `-` is optional) inside one line block. */
const DATE_LINE = /^-?\s*Date:\s*(.+)$/;

const firstDateLine = (lines: readonly string[]): string | undefined => {
  for (const line of lines) {
    const match = DATE_LINE.exec(line);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
};

/**
 * The newest `flaky/needs-decision` `labeled` event's `created_at`, or
 * `undefined` if none exists (including when the only such event has an
 * unreadable timestamp).
 *
 * Each candidate's format is validated with a self-comparison as it is
 * collected, not only inside the reduce comparator below:
 * `Array.prototype.reduce` with no seed never calls the comparator when the
 * array has exactly one element, so a single malformed `created_at` would
 * otherwise sail through uncompared and later throw deep inside
 * `computeRecommendation` — an uncaught exception that (unlike a `GhError`)
 * `buildRow`'s try/catch blocks do not cover, which would abort every row in
 * the multi-issue call. Skipping the malformed event here instead folds it
 * into the existing "no readable labeled event" outcome (`pausedAtStatus:
 * "unavailable"` on this row only, batch stays `ok: true`).
 */
const newestNeedsDecisionLabelTime = (
  events: readonly LabeledEvent[],
): string | undefined => {
  const labelTimes: string[] = [];
  for (const event of events) {
    if (
      event.event !== 'labeled' ||
      event.label?.name !== LABELS.needsDecision
    ) {
      continue;
    }
    try {
      compareIso(event.created_at, event.created_at);
    } catch {
      continue;
    }
    labelTimes.push(event.created_at);
  }
  if (labelTimes.length === 0) {
    return undefined;
  }
  return labelTimes.reduce((newest, candidate) =>
    compareIso(candidate, newest) > 0 ? candidate : newest,
  );
};

/**
 * A comment is automated when its author is a bot, or its body carries
 * either signature — mirrors `flaky-ci-routine.md`'s "Automated-author
 * signatures".
 */
const isAutomated = (
  comment: Comment,
  signatures: readonly string[],
): boolean =>
  comment.user.type === 'Bot' ||
  signatures.some((signature) => comment.body.includes(signature));

type Candidate = { readonly comment: Comment; readonly line: string };

/**
 * Automated comments whose LAST non-empty line begins with
 * `- Recommendation: ` — deliberately the opposite of 4-B's first-line rule
 * for `Date:` (see Step 5's "Last line, not first").
 *
 * Each candidate's `created_at` is validated with a self-comparison here, at
 * collection time — the same reasoning as `newestNeedsDecisionLabelTime`
 * above: `computeRecommendation`'s `.filter()` call and `newestCandidate`'s
 * reduce comparator both call `compareIso` on `candidate.comment.created_at`
 * with no guard, and `Array.prototype.reduce` with no seed never calls its
 * comparator for a single-element array, so a malformed date can reach either
 * of those call sites uncompared. Skipping it here — instead of guarding each
 * call site separately — means a comment with an unparsable `created_at` is
 * simply not a candidate: the surviving candidates (if any) still produce a
 * recommendation, and only the multi-issue call's own row is affected, not
 * the whole batch.
 */
const qualifyingCandidates = (
  comments: readonly Comment[],
  signatures: readonly string[],
): readonly Candidate[] =>
  comments.flatMap((comment) => {
    if (!isAutomated(comment, signatures)) {
      return [];
    }
    const nonEmptyLines = comment.body
      .split('\n')
      .filter((line) => line !== '');
    const lastLine = nonEmptyLines.at(-1);
    if (lastLine == null || !lastLine.startsWith(MARKERS.recommendation)) {
      return [];
    }
    try {
      compareIso(comment.created_at, comment.created_at);
    } catch {
      return [];
    }
    return [{ comment, line: lastLine.slice(MARKERS.recommendation.length) }];
  });

/** Newest by `created_at`, then by `id` — the same tie-break `read-repro-result` uses. */
const newestCandidate = (candidates: readonly Candidate[]): Candidate =>
  candidates.reduce((latest, candidate) => {
    const byTime = compareIso(
      candidate.comment.created_at,
      latest.comment.created_at,
    );
    if (byTime > 0) {
      return candidate;
    }
    if (byTime < 0) {
      return latest;
    }
    return candidate.comment.id > latest.comment.id ? candidate : latest;
  });

const MAY_BE_STALE_PREFIX = '(may be stale) ';

const computeRecommendation = (
  pausedAt: string | null,
  candidates: readonly Candidate[],
): {
  readonly recommendation: string | null;
  readonly source: RecommendationSource;
} => {
  if (pausedAt != null) {
    const windowStart = minusSeconds(pausedAt, PAUSE_WINDOW_SECONDS);
    const inWindow = candidates.filter(
      (candidate) => compareIso(candidate.comment.created_at, windowStart) > 0,
    );
    if (inWindow.length > 0) {
      return {
        recommendation: newestCandidate(inWindow).line,
        source: 'in-window',
      };
    }
  }
  if (candidates.length > 0) {
    return {
      recommendation: `${MAY_BE_STALE_PREFIX}${newestCandidate(candidates).line}`,
      source: 'widened',
    };
  }
  return { recommendation: null, source: 'none' };
};

/**
 * Comments whose FIRST line is an observation heading and whose date (first
 * `- Date:` line, falling back to `created_at` when absent) falls strictly
 * after `pausedAt` — mirrors Step 5's "New observations since pause" cell.
 *
 * Same guard as `qualifyingCandidates`: the resolved `date` (either the
 * `- Date:` line's text or `created_at`) is validated with a self-comparison
 * before it reaches the real `compareIso(date, pausedAt)` call. Without it, a
 * single qualifying observation comment with an unparsable date would throw
 * uncaught here and abort the whole multi-issue result, not just this row's
 * count. A comment that fails validation is excluded from the count, exactly
 * as if it were never an observation.
 */
const countNewObservations = (
  comments: readonly Comment[],
  pausedAt: string,
): number =>
  comments.filter((comment) => {
    const lines = comment.body.split('\n');
    const heading = lines[0] ?? '';
    const isObservation =
      heading.startsWith(COMMENT_HEADINGS.additionalObservation) ||
      heading.startsWith(COMMENT_HEADINGS.backfilledObservation);
    if (!isObservation) {
      return false;
    }
    const date = firstDateLine(lines) ?? comment.created_at;
    try {
      compareIso(date, date);
    } catch {
      return false;
    }
    return compareIso(date, pausedAt) > 0;
  }).length;

const AUTOMATED_SIGNATURES = [
  SIGNATURES.claudeCode,
  SIGNATURES.investigated,
] as const;

const buildRow = async (ghApi: GhApi, issue: string): Promise<Row> => {
  let events: readonly LabeledEvent[] = [];
  try {
    events = await ghApi.getAll<LabeledEvent>(
      `repos/growilabs/growi/issues/${issue}/events`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    // Fetching events failed outright — treated the same as "no labeled
    // event could be read" (the row's pausedAtStatus below), not a reason to
    // fail the whole multi-row result.
  }

  let comments: readonly Comment[] = [];
  try {
    comments = await ghApi.getAll<Comment>(
      `repos/growilabs/growi/issues/${issue}/comments`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    // Same reasoning as above: this row's recommendation/newObservations
    // fall back to their "nothing found" values instead of failing the run.
  }

  const pausedAt = newestNeedsDecisionLabelTime(events) ?? null;
  const pausedAtStatus: Row['pausedAtStatus'] =
    pausedAt != null ? 'ok' : UNAVAILABLE;

  const candidates = qualifyingCandidates(comments, AUTOMATED_SIGNATURES);
  const { recommendation, source } = computeRecommendation(
    pausedAt,
    candidates,
  );

  const newObservations =
    pausedAt != null ? countNewObservations(comments, pausedAt) : null;

  return {
    issue,
    pausedAt,
    pausedAtStatus,
    recommendation,
    recommendationSource: source,
    newObservations,
  };
};

export const run = async (
  ghApi: GhApi,
  args: CliArgs,
): Promise<ScriptResult> => {
  const rows: Row[] = [];
  for (const issue of args.issues) {
    // biome-ignore lint/performance/noAwaitInLoops: each issue is an independent GitHub read; there is nothing to batch them into.
    rows.push(await buildRow(ghApi, issue));
  }
  return { ok: true, facts: { rows } };
};

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (entry == null) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
};

if (isMainModule()) {
  const parsed = parseArgv(process.argv.slice(2));
  if (parsed.kind === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  } else if (parsed.kind === 'invalid') {
    emit({ ok: false, failure: { reason: parsed.reason } });
  } else {
    run(createGhApi(), parsed.value).then(emit);
  }
}
