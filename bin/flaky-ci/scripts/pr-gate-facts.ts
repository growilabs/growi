#!/usr/bin/env node
/**
 * The fact set `investigate-flaky-test/SKILL.md` 6-B's PR gate conditions 1
 * and 2 are decided from, for one fix commit: the repro tally pinned to that
 * commit, the commit's `ci-app-*` check-run outcomes, and the files the fix
 * changed relative to the base branch. Condition 3 (whether that file list
 * stays inside the scope Step 3 identified) and the HIGH/MEDIUM/LOW table
 * stay a judgment in the procedure — this script only gathers what those
 * judgments read.
 *
 * Usage: node pr-gate-facts.ts --issue <number> --sha <sha> [--base <ref>]
 *
 * `tally` and `ciApp` are the same facts `read-repro-result.ts` and
 * `check-runs-facts.ts` report — `tally` reuses `lib/repro-result.ts`'s
 * `selectNewestMatch` (the same newest-by-`created_at`-then-`id` tie-break),
 * and `ciApp` reuses `lib/check-runs.ts`'s `dedupeNewestByName` /
 * `aggregateCiApp` — so this script cannot drift from what those two scripts
 * already mean by "the tally for this commit" / "not success". This script
 * makes its own GitHub calls rather than reading `read-repro-result.ts` /
 * `check-runs-facts.ts`'s prior output from disk: it is a single self-
 * contained call, like every other script here, and a fix commit's repro
 * comment and check-runs are cheap, idempotent GET reads.
 *
 * Unlike `read-repro-result.ts`, a fix commit with no matching `### Repro
 * result` comment is not itself a failure of this script: `tally: null` is a
 * normal fact ("not measured yet"), because 6-B's condition 1 already has a
 * "no result comment" reading of its own (the MEDIUM row). Likewise
 * `ciApp.total === 0` is a normal fact ("nothing ran"), not a failure —
 * 6-B's condition 2 treats a total of zero as failing, but that is the
 * procedure's judgment, not this script's.
 *
 * `changedFiles[]` is `git diff --name-only <base>...<sha>` (three-dot: what
 * the fix commits changed since they left `base`, not everything `base`
 * gained since the branch point) — the same command 6-B used to run inline.
 * This is the one script in this directory that reads local git state
 * rather than only `gh api`: 6-A already assumes a local checkout of the fix
 * branch (`git push`, `git rev-parse`), so this adds no new environment
 * requirement. The procedure must `git fetch origin master` (or whatever
 * `--base` names) before calling this, exactly as it did before extraction.
 *
 * Output fields (exit 0):
 * - `tally` — `null`, or `runs`/`failed`/`perRun[]`/`workflowRunUrl`/
 *   `commentUrl` for the newest `### Repro result` comment pinned to `--sha`.
 * - `ciApp` — `total` (deduped `ci-app-*` check-run count) and
 *   `notSuccess[]` (those whose `conclusion` is not `"success"`).
 * - `changedFiles[]` — paths changed by `--sha` since it diverged from
 *   `--base`, three-dot form.
 * Exit 2: the issue-comments call, the check-runs call, or the local `git
 * diff` failed outright (this is not the tally being absent or the
 * check-run total being zero — see above).
 */
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  aggregateCiApp,
  dedupeNewestByName,
  type RawCheckRun,
  type RawCheckRunsPage,
} from '../lib/check-runs.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult } from '../lib/output.ts';
import { type ReproComment, selectNewestMatch } from '../lib/repro-result.ts';

const HELP = `Usage: node pr-gate-facts.ts --issue <number> --sha <sha> [--base <ref>]

Returns the repro tally and ci-app-* outcomes for --sha (same shape as
read-repro-result.ts / check-runs-facts.ts), plus the files --sha changed
relative to --base (default: origin/master, three-dot diff).

Output fields (exit 0): tally (null, or runs/failed/perRun[]/
workflowRunUrl/commentUrl), ciApp (total, notSuccess[]), changedFiles[].
Exit code 2: the comments call, the check-runs call, or the local git diff
failed outright.
`;

const DEFAULT_BASE = 'origin/master';
const PER_PAGE = 100;

export type CliArgs = {
  readonly issue: string;
  readonly sha: string;
  readonly base: string;
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

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  const issue = flagValue(argv, 'issue');
  const sha = flagValue(argv, 'sha');
  if (issue == null || sha == null) {
    return { kind: 'invalid', reason: '--issue and --sha are both required' };
  }
  const base = flagValue(argv, 'base') ?? DEFAULT_BASE;
  return { kind: 'args', value: { issue, sha, base } };
};

/** Every path `git diff --name-only <base>...<sha>` printed, or throws on a non-zero exit / missing `git`. */
export type GitDiff = (base: string, sha: string) => Promise<readonly string[]>;

const execFileAsync = promisify(execFile);

export const defaultGitDiff: GitDiff = async (base, sha) => {
  const { stdout } = await execFileAsync('git', [
    'diff',
    '--name-only',
    `${base}...${sha}`,
  ]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
};

const toFailure = (reason: string): ScriptResult => ({
  ok: false,
  failure: { reason },
});

export const run = async (
  ghApi: GhApi,
  gitDiff: GitDiff,
  args: CliArgs,
): Promise<ScriptResult> => {
  let comments: readonly ReproComment[];
  try {
    comments = await ghApi.getAll<ReproComment>(
      `repos/growilabs/growi/issues/${args.issue}/comments`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      // Not a precondition failure this script knows how to name — let it
      // surface as an unexpected exception (exit 1) rather than mislabel it.
      throw error;
    }
    return toFailure(
      `could not fetch comments on issue ${args.issue}: ${error.message}`,
    );
  }
  const match = selectNewestMatch(comments, args.sha);
  const tally =
    match == null
      ? null
      : {
          runs: match.result.runs,
          failed: match.result.failed,
          perRun: match.result.perRun,
          workflowRunUrl: match.result.workflowRunUrl,
          commentUrl: match.comment.html_url,
        };

  const rawChecks: RawCheckRun[] = [];
  try {
    for (let page = 1; ; page += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the number of pages is only known from the previous page, so these requests cannot be batched.
      const body = await ghApi.get<RawCheckRunsPage>(
        `repos/growilabs/growi/commits/${args.sha}/check-runs`,
        { per_page: PER_PAGE, page },
      );
      rawChecks.push(...body.check_runs);
      if (body.check_runs.length < PER_PAGE) {
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    return toFailure(
      `could not fetch check-runs for commit ${args.sha}: ${error.message}`,
    );
  }
  const ciApp = aggregateCiApp(dedupeNewestByName(rawChecks));

  let changedFiles: readonly string[];
  try {
    changedFiles = await gitDiff(args.base, args.sha);
  } catch (error) {
    return toFailure(
      `could not diff ${args.base}...${args.sha}: ${(error as Error).message}`,
    );
  }

  return {
    ok: true,
    facts: { tally, ciApp, changedFiles },
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
    run(createGhApi(), defaultGitDiff, parsed.value).then(emit);
  }
}
