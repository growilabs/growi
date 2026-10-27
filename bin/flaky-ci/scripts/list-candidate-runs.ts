#!/usr/bin/env node
/**
 * Completed runs of one workflow within a trailing time window — the fact
 * `detect-flaky-ci/SKILL.md` Step 1 used to build by hand-rolling a `while`
 * loop of `gh api` + `jq` + `date -d` over the workflow's runs endpoint.
 *
 * Replaces that manual pagination shell entirely. What stays a judgment in
 * the procedure: reporting the truncation to the reader when `truncated` is
 * `true`, and treating a same-SHA attempt reversal within the returned list
 * as a confirmed flaky occurrence (Step 1's "same-SHA reruns" paragraph) —
 * this script only returns the raw per-run `attempt` numbers, it does not
 * group by `headSha` or decide what a reversal means.
 *
 * Usage: node list-candidate-runs.ts --workflow <file.yml> --window-hours <n> --max-runs <n>
 *
 * Output fields (exit 0): runs[] — id, conclusion, headSha, createdAt, url,
 * event, attempt — for every completed run whose createdAt falls within the
 * trailing --window-hours, newest first; truncated (boolean) — true when
 * --max-runs was reached before the window was exhausted. Zero runs in the
 * window is exit 0 with an empty array, not a failure.
 * Exit 2: --workflow/--window-hours/--max-runs missing or not a positive
 * integer where a number is required, or the GitHub API could not be read at
 * all (not one page misbehaving — no run could be fetched).
 */
import { pathToFileURL } from 'node:url';

import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult } from '../lib/output.ts';
import { compareIso, minusSeconds } from '../lib/time.ts';

const HELP = `Usage: node list-candidate-runs.ts --workflow <file.yml> --window-hours <n> --max-runs <n>

Lists this workflow's completed runs created within the trailing
--window-hours, newest first, stopping early (truncated: true) if --max-runs
is reached first.

Output fields (exit 0): runs[] (id, conclusion, headSha, createdAt, url,
event, attempt), truncated
Exit code 2: a required argument is missing or not a positive integer, or the
GitHub API could not be read at all
`;

export type CliArgs = {
  readonly workflow: string;
  readonly windowHours: number;
  readonly maxRuns: number;
};

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
  const workflow = flagValue(argv, 'workflow');
  const windowHours = parsePositiveInteger(flagValue(argv, 'window-hours'));
  const maxRuns = parsePositiveInteger(flagValue(argv, 'max-runs'));
  if (workflow == null || windowHours == null || maxRuns == null) {
    return {
      kind: 'invalid',
      reason:
        '--workflow, --window-hours and --max-runs are all required, and --window-hours/--max-runs must be positive integers',
    };
  }
  return { kind: 'args', value: { workflow, windowHours, maxRuns } };
};

type RawRun = {
  readonly id: number;
  readonly conclusion: string | null;
  readonly head_sha: string;
  readonly created_at: string;
  readonly html_url: string;
  readonly event: string;
  readonly run_attempt: number;
};

type RawRunsPage = {
  readonly workflow_runs: readonly RawRun[];
};

export type Run = {
  readonly id: number;
  readonly conclusion: string | null;
  readonly headSha: string;
  readonly createdAt: string;
  readonly url: string;
  readonly event: string;
  readonly attempt: number;
};

const toRun = (raw: RawRun): Run => ({
  id: raw.id,
  conclusion: raw.conclusion,
  headSha: raw.head_sha,
  createdAt: raw.created_at,
  url: raw.html_url,
  event: raw.event,
  attempt: raw.run_attempt,
});

const PER_PAGE = 100;

/**
 * `GhApi.getAll` is not used here: it assumes every page's body is a bare
 * array and pages until a short page proves the end (design.md's `gh.ts`
 * contract), but the workflow-runs endpoint's body is
 * `{ total_count, workflow_runs: [...] }`, and this script must also stop
 * early — at --max-runs, or once a page's oldest run falls outside
 * --window-hours — neither of which `getAll` supports. Paging is composed
 * here from `GhApi.get` instead, one page at a time, ending on the first
 * empty page (the same `[ "$count" -eq 0 ] && break` condition the manual
 * shell loop used) rather than on a short page: a page can legitimately be
 * shorter than `per_page` while more still remain if GitHub's own listing
 * order shifts between requests, and testing this against fixed-size
 * recorded fixture pages would otherwise require every fixture page to be
 * a full 100 items.
 */
export const run = async (
  ghApi: GhApi,
  nowIso: () => string,
  args: CliArgs,
): Promise<ScriptResult> => {
  const cutoff = minusSeconds(nowIso(), args.windowHours * 3600);
  const collected: Run[] = [];
  let truncated = false;

  try {
    for (let page = 1; ; page += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the number of pages is only known from the previous page, so these requests cannot be batched.
      const body = await ghApi.get<RawRunsPage>(
        `repos/growilabs/growi/actions/workflows/${args.workflow}/runs`,
        { status: 'completed', per_page: PER_PAGE, page },
      );
      const pageRuns = body.workflow_runs;
      if (pageRuns.length === 0) {
        break;
      }
      for (const raw of pageRuns) {
        collected.push(toRun(raw));
      }
      if (collected.length >= args.maxRuns) {
        truncated = true;
        break;
      }
      const oldestOnPage = pageRuns.at(-1);
      if (
        oldestOnPage != null &&
        compareIso(oldestOnPage.created_at, cutoff) < 0
      ) {
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    if (collected.length === 0) {
      return {
        ok: false,
        failure: {
          reason: `could not fetch runs for workflow ${args.workflow}: ${error.message}`,
        },
      };
    }
    // A page fetched fine and then a later page failed outright (as opposed
    // to a well-formed empty page). Some real runs were already collected,
    // so this is not "no run could be fetched" (the design.md exit-2
    // condition) — but the list is not the full window either. Folding this
    // into the same `truncated` signal the --max-runs case uses means the
    // procedure's existing "report the truncation" handling covers it too,
    // rather than inventing a second, untested incompleteness field.
    truncated = true;
  }

  // A run on the crossing page can be older than --window-hours even though
  // an earlier run on the same page is not (pages are ordered newest first,
  // but the cutoff falls partway through the last page fetched); drop those
  // here rather than relying on the per-page break to have excluded them.
  const runs = collected.filter(
    (candidate) => compareIso(candidate.createdAt, cutoff) >= 0,
  );

  return { ok: true, facts: { runs, truncated } };
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
