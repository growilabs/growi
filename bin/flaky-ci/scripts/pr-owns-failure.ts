#!/usr/bin/env node
/**
 * Whether a failing commit's own PR(s) explain the failure well enough that
 * `detect-flaky-ci/SKILL.md`'s "Failures the PR itself owns" check should
 * exclude it before Step 4 — the fact-gathering half of that check (Steps
 * A~C of the procedure). The procedure keeps the exclude/continue judgment,
 * including "fail open: on exit 2, do not exclude, continue as usual".
 *
 * Usage: node pr-owns-failure.ts --sha <sha> --spec-path <path>
 *
 * `--spec-path` may be an empty string for a Playwright job-level fallback
 * identity (no spec path to match against — `touchesSpec` is always `false`
 * for those, and no per-PR file fetch is made at all).
 *
 * `pulls[]` is gathered two ways, matching the procedure's Step B: first
 * `GET commits/{sha}/pulls` (the direct route); if that comes back empty,
 * the commit's message is read and every `Merge of #{N}` line is extracted
 * (Mergify's merge-queue route — a queue commit drops its direct PR
 * association once the queue entry is done). Only that literal line shape is
 * matched; arbitrary `#{N}` tokens elsewhere in the message (a squashed
 * body's `Refs #...` / `Fixes #...`) are not PR associations and must not be
 * picked up. Merge-queue-derived entries carry `base: null, state: null` —
 * the procedure does not filter or report on either field ("Do not filter
 * by base branch either"), so there is no need for the extra `GET
 * pulls/{n}` call (and its own failure surface) just to fill them in.
 *
 * `ancestryStatus` is the raw `GET compare/master...{sha}` `.status` string
 * (`identical` / `behind` / `ahead` / `diverged`) — the ancestor/non-ancestor
 * split stays a procedure judgment (Requirement 2.1). `pulls[]` and
 * `touchesSpec` are always computed regardless of `ancestryStatus`, even
 * though the old Step A stopped at `identical`/`behind` and never ran
 * Steps B/C at all: this script always returns the full fact set for a
 * single call, same as every other script in this directory. One
 * consequence: a transient B/C failure now yields exit 2 ("unresolved
 * check") even for a commit that IS an ancestor, where the old procedure
 * would have reached a confident answer with zero further calls. This is a
 * deliberate uniformity trade-off, not an oversight — see the task's
 * Implementation Notes.
 *
 * Path rooting note carried over from the procedure (`README.md` documents
 * this too): a PR's `files[].filename` is repository-root-relative
 * (`apps/app/src/....ts`), while a vitest identity's spec path is
 * `apps/app`-relative (`src/....ts`). `--spec-path` must be passed in the
 * `apps/app`-relative form; matching is by suffix (`filename === specPath ||
 * filename.endsWith('/' + specPath)`), never equality.
 *
 * Output fields (exit 0): ancestryStatus, pulls[] (`number`, `base`,
 * `state`, `touchesSpec`), touchesSpec (`pulls.some(p => p.touchesSpec)`),
 * noPr (`pulls.length === 0`).
 * Exit 2: the compare call, the commits/pulls call, the commit-message
 * fallback call, or any PR's files call failed.
 */
import { pathToFileURL } from 'node:url';

import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node pr-owns-failure.ts --sha <sha> --spec-path <path>

Returns the failing commit's ancestry relative to master, the PR(s) it is
associated with, and whether any of those PRs' changed files match
--spec-path. --spec-path may be an empty string for a Playwright job-level
identity that has no spec path to match against.

Output fields (exit 0): ancestryStatus, pulls[] (number, base, state,
touchesSpec), touchesSpec, noPr.
Exit code 2: the compare, commits/pulls, commit-message, or PR-files call
failed.
`;

export type CliArgs = {
  readonly sha: string;
  readonly specPath: string;
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
  const sha = flagValue(argv, 'sha');
  const specPath = flagValue(argv, 'spec-path');
  if (sha == null || specPath == null) {
    return {
      kind: 'invalid',
      reason: '--sha and --spec-path are both required',
    };
  }
  return { kind: 'args', value: { sha, specPath } };
};

/** Matches only a literal `Merge of #{N}` line, never a stray `#{N}` token. */
const MERGE_QUEUE_LINE = /^Merge of #(\d+)/gm;

export const extractMergeQueuePrNumbers = (
  commitMessage: string,
): readonly number[] => {
  const numbers: number[] = [];
  for (const match of commitMessage.matchAll(MERGE_QUEUE_LINE)) {
    numbers.push(Number(match[1]));
  }
  return numbers;
};

/** `filenameFromPr` is repo-root-relative; `specPath` is `apps/app`-relative. */
export const matchesSpecPath = (
  filenameFromPr: string,
  specPath: string,
): boolean =>
  specPath !== '' &&
  (filenameFromPr === specPath || filenameFromPr.endsWith(`/${specPath}`));

type RawDirectPull = {
  readonly number: number;
  readonly base?: { readonly ref?: string };
  readonly state?: string;
};

type PullFact = {
  readonly number: number;
  readonly base: string | null;
  readonly state: string | null;
  touchesSpec: boolean;
};

const toFailure = (reason: string): ScriptResult => ({
  ok: false,
  failure: { reason },
});

export const run = async (
  ghApi: GhApi,
  args: CliArgs,
): Promise<ScriptResult> => {
  let ancestryStatus: string;
  try {
    const compare = await ghApi.get<{ status: string }>(
      `repos/growilabs/growi/compare/master...${args.sha}`,
    );
    ancestryStatus = compare.status;
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    return toFailure(
      `could not compare commit ${args.sha} against master: ${error.message}`,
    );
  }

  let directPulls: readonly RawDirectPull[];
  try {
    directPulls = await ghApi.getAll<RawDirectPull>(
      `repos/growilabs/growi/commits/${args.sha}/pulls`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      throw error;
    }
    return toFailure(
      `could not fetch PRs associated with commit ${args.sha}: ${error.message}`,
    );
  }

  let pulls: PullFact[];
  if (directPulls.length > 0) {
    pulls = directPulls.map((pull) => ({
      number: pull.number,
      base: pull.base?.ref ?? null,
      state: pull.state ?? null,
      touchesSpec: false,
    }));
  } else {
    let commitMessage: string;
    try {
      const commit = await ghApi.get<{ commit: { message: string } }>(
        `repos/growilabs/growi/commits/${args.sha}`,
      );
      commitMessage = commit.commit.message;
    } catch (error) {
      if (!(error instanceof GhError)) {
        throw error;
      }
      return toFailure(
        `could not fetch commit message for ${args.sha} (merge-queue fallback): ${error.message}`,
      );
    }
    pulls = extractMergeQueuePrNumbers(commitMessage).map((number) => ({
      number,
      base: null,
      state: null,
      touchesSpec: false,
    }));
  }

  const noPr = pulls.length === 0;

  if (args.specPath !== '') {
    for (const pull of pulls) {
      let files: readonly { readonly filename: string }[];
      try {
        // biome-ignore lint/performance/noAwaitInLoops: a files-fetch failure fails the whole call (see module doc), so there is no batching benefit worth losing the early-exit for.
        files = await ghApi.getAll<{ readonly filename: string }>(
          `repos/growilabs/growi/pulls/${pull.number}/files`,
        );
      } catch (error) {
        if (!(error instanceof GhError)) {
          throw error;
        }
        return toFailure(
          `could not fetch changed files for PR #${pull.number} (commit ${args.sha}): ${error.message}`,
        );
      }
      pull.touchesSpec = files.some((file) =>
        matchesSpecPath(file.filename, args.specPath),
      );
    }
  }

  const touchesSpec = pulls.some((pull) => pull.touchesSpec);

  return {
    ok: true,
    facts: { ancestryStatus, pulls, touchesSpec, noPr },
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
    run(createGhApi(), parsed.value).then(emit);
  }
}
