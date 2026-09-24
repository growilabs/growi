#!/usr/bin/env node
/**
 * Every `flaky/suspected`, still-open issue for which no repro measurement
 * has ever been attempted, once it has sat unmeasured longer than
 * --stale-days — the visibility gap Requirement 2 exists for: `flaky/
 * observing` auto-closes after 14 days with no recurrence, but `flaky/
 * suspected` / `flaky/confirmed` never auto-close by design, so a suspected
 * issue nobody ever got around to reproducing can sit forever with no signal
 * that it is stuck.
 *
 * Scope is intentionally narrower than `fetch-flaky-issues.ts`'s default
 * (all three tier labels): only `state=open` and `labels=flaky/suspected`,
 * because a `flaky/confirmed` or `flaky/observing` issue already has (or
 * never needed) a measurement and is out of scope for this check.
 *
 * "Unmeasured" means no comment on the issue starts with `### Repro result`
 * — a `flaky-repro.yml` run always posts one, so its absence means the repro
 * workflow was never triggered for this issue at all.
 *
 * Usage: node stale-suspected.ts [--stale-days <n>]
 *
 * Output fields (exit 0): staleDays (the threshold used), staleIssues[] —
 * number, firstSeen (ISO-8601 UTC), daysSince — for every unmeasured
 * flaky/suspected issue whose days-since-firstSeen has reached staleDays;
 * unavailableIssues[] — issue numbers whose own comments could not be read,
 * so their measurement state (and therefore staleness) could not be
 * determined at all. Per output.ts's multi-row convention, such an issue is
 * never silently dropped: it is reported here instead of in staleIssues, so
 * "0 stale issues" in the report is never confused with "some issues were
 * hidden by an API error". Zero matching issues is exit 0 with an empty
 * array, not a failure. Never changes a label or closes an issue — read-only.
 * Exit 2: --stale-days was given but is not a positive integer, or the
 * flaky/suspected issue list itself could not be fetched at all.
 */
import { pathToFileURL } from 'node:url';

import { COMMENT_HEADINGS, LABELS } from '../lib/constants.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { computeOccurrenceSummary } from '../lib/occurrence-summary.ts';
import { emit, type ScriptResult } from '../lib/output.ts';
import { daysBetween } from '../lib/time.ts';

const DEFAULT_STALE_DAYS = 14;

const HELP = `Usage: node stale-suspected.ts [--stale-days <n>]

Lists every still-open flaky/suspected issue with no ### Repro result
comment (i.e. never measured), once it has been unmeasured for at least
--stale-days (default: ${DEFAULT_STALE_DAYS}). Never closes an issue or
changes a label.

Output fields (exit 0): staleDays, staleIssues[] (number, firstSeen,
daysSince), unavailableIssues[] (issue numbers whose comments could not be
read, so their staleness is unknown rather than confirmed absent)
Exit code 2: --stale-days is not a positive integer, or the flaky/suspected
issue list could not be fetched at all
`;

export type CliArgs = { readonly staleDays: number };

export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'args'; readonly value: CliArgs }
  | { readonly kind: 'invalid'; readonly reason: string };

const flagValue = (
  argv: readonly string[],
  name: string,
): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

/** A positive integer written in base 10, with no surrounding whitespace. */
const POSITIVE_INTEGER = /^[1-9]\d*$/;

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (value == null || !POSITIVE_INTEGER.test(value)) {
    return null;
  }
  return Number(value);
};

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  const given = flagValue(argv, 'stale-days');
  if (given == null) {
    return { kind: 'args', value: { staleDays: DEFAULT_STALE_DAYS } };
  }
  const staleDays = parsePositiveInteger(given);
  if (staleDays == null) {
    return {
      kind: 'invalid',
      reason: '--stale-days must be a positive integer',
    };
  }
  return { kind: 'args', value: { staleDays } };
};

type RawLabel = { readonly name: string };

type RawIssue = {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly labels: readonly RawLabel[];
};

type RawComment = { readonly body: string };

export type StaleIssue = {
  readonly number: number;
  readonly firstSeen: string;
  readonly daysSince: number;
};

const isUnmeasured = (comments: readonly RawComment[]): boolean =>
  !comments.some((comment) =>
    comment.body.startsWith(COMMENT_HEADINGS.reproResult),
  );

/**
 * `null` means the fetch itself failed (a `GhError`) for this one issue —
 * distinct from an empty array (a legitimate "no comments yet" fact).
 */
const fetchComments = async (
  ghApi: GhApi,
  issueNumber: number,
): Promise<readonly RawComment[] | null> => {
  try {
    return await ghApi.getAll<RawComment>(
      `repos/growilabs/growi/issues/${issueNumber}/comments`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    return null;
  }
};

export const run = async (
  ghApi: GhApi,
  nowIso: () => string,
  args: CliArgs,
): Promise<ScriptResult> => {
  let rawIssues: readonly RawIssue[];
  try {
    rawIssues = await ghApi.getAll<RawIssue>('repos/growilabs/growi/issues', {
      state: 'open',
      labels: LABELS.suspected,
    });
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    return {
      ok: false,
      failure: {
        reason: `could not fetch ${LABELS.suspected} issues: ${error.message}`,
      },
    };
  }

  const now = nowIso();
  const staleIssues: StaleIssue[] = [];
  const unavailableIssues: number[] = [];

  for (const raw of rawIssues) {
    // biome-ignore lint/performance/noAwaitInLoops: each issue's comments are an independent GitHub read; there is nothing to batch them into.
    const comments = await fetchComments(ghApi, raw.number);
    if (comments == null) {
      // This issue's own measurement state could not be confirmed (its
      // comments could not be read). Per output.ts's multi-row convention,
      // the row is not silently dropped — it is reported in
      // unavailableIssues instead of staleIssues, so an API hiccup here can
      // never be mistaken for "this issue is not stale".
      unavailableIssues.push(raw.number);
      continue;
    }
    if (!isUnmeasured(comments)) {
      continue;
    }
    const { firstSeen } = computeOccurrenceSummary({
      number: raw.number,
      title: raw.title,
      labels: raw.labels.map((label) => label.name),
      body: raw.body,
      comments,
    });
    if (firstSeen == null) {
      // daysSince cannot be computed without a firstSeen; excluding this
      // single candidate from staleIssues (not failing the whole call). This
      // differs from the comments-fetch failure above: the comments were
      // read successfully and confirm the issue IS unmeasured, so it is a
      // genuine (if date-unknown) candidate, not an unreadable row — but
      // with no firstSeen there is nothing to sort it by relative to
      // --stale-days, so it is left out of both arrays rather than invented.
      continue;
    }
    const daysSince = daysBetween(firstSeen, now);
    if (daysSince >= args.staleDays) {
      staleIssues.push({ number: raw.number, firstSeen, daysSince });
    }
  }

  return {
    ok: true,
    facts: { staleDays: args.staleDays, staleIssues, unavailableIssues },
  };
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
    run(createGhApi(), () => new Date().toISOString(), parsed.value).then(emit);
  }
}
