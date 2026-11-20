#!/usr/bin/env node
/**
 * Reads the `### Repro result` comment that belongs to one commit, on one
 * flaky-tracking issue.
 *
 * Replaces the `gh api ... --slurp | jq ...` pipeline that used to appear
 * twice in `investigate-flaky-test/SKILL.md` (2-D and 6-A): fetch every
 * comment on the issue, keep the ones whose `- Commit:` line names `--sha`
 * (`lib/repro-result.ts` decides that per comment), and — because a manually
 * re-run repro job can leave two comments for the same commit — take the
 * newest by `created_at`, then `id`, when more than one matches.
 *
 * Usage: node read-repro-result.ts --issue <number> --sha <sha>
 *
 * Output fields (exit 0): runs, failed, perRun[], workflowRunUrl, commentUrl
 * Exit 2: no `### Repro result` comment on the issue carries that commit.
 */
import { pathToFileURL } from 'node:url';

import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult } from '../lib/output.ts';
import { type ReproComment, selectNewestMatch } from '../lib/repro-result.ts';

const HELP = `Usage: node read-repro-result.ts --issue <number> --sha <sha>

Reads the \`### Repro result\` comment on the issue whose \`- Commit:\` line
matches --sha, and reports its tally.

Output fields (exit 0): runs, failed, perRun[], workflowRunUrl, commentUrl
Exit code 2: no matching comment
`;

export type CliArgs = { readonly issue: string; readonly sha: string };

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
  return { kind: 'args', value: { issue, sha } };
};

export const run = async (
  ghApi: GhApi,
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
    return { ok: false, failure: { reason: error.message } };
  }

  const winner = selectNewestMatch(comments, args.sha);

  if (winner == null) {
    return {
      ok: false,
      failure: {
        reason: `no ### Repro result comment on issue ${args.issue} carries - Commit: ${args.sha}`,
      },
    };
  }

  return {
    ok: true,
    facts: {
      runs: winner.result.runs,
      failed: winner.result.failed,
      perRun: winner.result.perRun,
      workflowRunUrl: winner.result.workflowRunUrl,
      commentUrl: winner.comment.html_url,
    },
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
