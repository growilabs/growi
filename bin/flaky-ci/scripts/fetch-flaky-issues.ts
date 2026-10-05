#!/usr/bin/env node
/**
 * Every flaky-tracking issue (both open and closed) carrying one of the
 * given labels, with its full body and every comment's full text — the
 * data `detect-flaky-ci/SKILL.md` Step 1.5 used to build with three
 * hand-written `gh api --paginate` calls plus a per-issue comments fetch.
 *
 * Replaces that fetch entirely. What stays a judgment in the procedure:
 * extracting `actions/runs/{id}` URLs out of `body`/`comments[].body` into
 * the Step 1.5 skip-list, title/state matching against an identity key
 * (`investigate-flaky-test/SKILL.md` Step 1), and reading `### Collateral
 * candidate` rows out of `comments[].body` — this script only returns the
 * issues and their raw text, it does not interpret any of it.
 *
 * Usage: node fetch-flaky-issues.ts [--labels <name> ...]
 *
 * Output fields (exit 0): issues[] — one per issue matching any of
 * --labels (state=all, so both open and closed), each with number, title,
 * state, body, labels[] (label names), comments[] (id, body — full text,
 * not an excerpt), commentsStatus ("ok" or "unavailable" — that issue's
 * comments could not be read, so its comments[] is empty rather than
 * complete; the rest of the row is still reported, per the multi-row
 * convention in design.md's Error Handling); labelFetchFailures[] — the
 * requested labels (if any) whose list fetch failed outright, so the
 * caller can tell "this label genuinely has zero issues right now" apart
 * from "this label's fetch failed and issues[] is missing its rows" —
 * a list-level fact (mirrors list-candidate-runs.ts's `truncated`), not a
 * per-issue field, since it describes an entire label's list going
 * missing, not one row's value being unreadable.
 * Exit 2: no issue could be fetched for any of the requested labels (the
 * GitHub API failed before a single label's list could be read).
 */
import { pathToFileURL } from 'node:url';

import { LABELS } from '../lib/constants.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult, UNAVAILABLE } from '../lib/output.ts';

const HELP = `Usage: node fetch-flaky-issues.ts [--labels <name> ...]

Fetches every issue (state=all) carrying any of --labels (default:
${LABELS.observing}, ${LABELS.suspected}, ${LABELS.confirmed}), each with
its full body and every comment's full text.

Output fields (exit 0): issues[] (number, title, state, body, labels[],
comments[] (id, body), commentsStatus ("ok" or "unavailable")),
labelFetchFailures[] (requested labels whose list fetch failed outright)
Exit code 2: no issue could be fetched for any of the requested labels
`;

const DEFAULT_LABELS: readonly string[] = [
  LABELS.observing,
  LABELS.suspected,
  LABELS.confirmed,
];

export type CliArgs = { readonly labels: readonly string[] };

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
  const given = flagValues(argv, 'labels');
  return {
    kind: 'args',
    value: { labels: given.length > 0 ? given : DEFAULT_LABELS },
  };
};

type RawLabel = { readonly name: string };

type RawIssue = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly body: string | null;
  readonly labels: readonly RawLabel[];
};

type RawComment = { readonly id: number; readonly body: string };

export type Comment = { readonly id: number; readonly body: string };

export type Issue = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly body: string | null;
  readonly labels: readonly string[];
  readonly comments: readonly Comment[];
  readonly commentsStatus: 'ok' | typeof UNAVAILABLE;
};

/**
 * One label's issue list. `null` means the fetch itself failed (a `GhError`)
 * — distinct from an empty array, which is a legitimate "no issue carries
 * this label" fact.
 */
const fetchIssuesForLabel = async (
  ghApi: GhApi,
  label: string,
): Promise<readonly RawIssue[] | null> => {
  try {
    return await ghApi.getAll<RawIssue>('repos/growilabs/growi/issues', {
      state: 'all',
      labels: label,
    });
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    return null;
  }
};

const buildIssue = async (ghApi: GhApi, raw: RawIssue): Promise<Issue> => {
  let comments: readonly RawComment[] = [];
  let commentsStatus: Issue['commentsStatus'] = 'ok';
  try {
    comments = await ghApi.getAll<RawComment>(
      `repos/growilabs/growi/issues/${raw.number}/comments`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    // This issue's comments could not be read — the row still reports its
    // number/title/state/body/labels (all already in hand from the list
    // call), just with an empty comments[] and the status flagged, per the
    // multi-row convention: one unreadable field must not hide the row.
    commentsStatus = UNAVAILABLE;
  }
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    body: raw.body,
    labels: raw.labels.map((label) => label.name),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
    })),
    commentsStatus,
  };
};

export const run = async (
  ghApi: GhApi,
  args: CliArgs,
): Promise<ScriptResult> => {
  const byNumber = new Map<number, RawIssue>();
  const labelFetchFailures: string[] = [];

  for (const label of args.labels) {
    // biome-ignore lint/performance/noAwaitInLoops: each label is an independent GitHub read; there is nothing to batch them into.
    const raw = await fetchIssuesForLabel(ghApi, label);
    if (raw == null) {
      labelFetchFailures.push(label);
      continue;
    }
    for (const issue of raw) {
      // An issue can in principle carry more than one of the requested tier
      // labels; whichever label's page it was read from, the issue itself
      // is identical, so last-write-wins here causes no divergence.
      byNumber.set(issue.number, issue);
    }
  }

  if (labelFetchFailures.length === args.labels.length) {
    return {
      ok: false,
      failure: {
        reason: `could not fetch issues for any of the requested labels (${args.labels.join(', ')})`,
      },
    };
  }

  const sortedRaws = [...byNumber.values()].sort((a, b) => a.number - b.number);

  const issues: Issue[] = [];
  for (const raw of sortedRaws) {
    // biome-ignore lint/performance/noAwaitInLoops: each issue's comments are an independent GitHub read; there is nothing to batch them into.
    issues.push(await buildIssue(ghApi, raw));
  }

  return { ok: true, facts: { issues, labelFetchFailures } };
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
