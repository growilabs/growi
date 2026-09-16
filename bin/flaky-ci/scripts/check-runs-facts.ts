#!/usr/bin/env node
/**
 * The commit's check-runs, deduped to the newest per name — the fact
 * `investigate-flaky-test/SKILL.md` 2-C and 6-A used to build with a
 * `gh api ... --paginate --slurp | jq 'group_by(.name) | map(sort_by(.started_at) | last)'`
 * pipeline.
 *
 * Single-shot: this script makes exactly one round of GitHub calls and
 * reports what it sees right now. Whether that is enough to stop waiting, or
 * the procedure should call this again after a short sleep, stays a judgment
 * in the procedure (2-C's ~5-minute/30-minute caps, 6-A's 5-/45-minute caps)
 * — this script has no wait loop of its own.
 *
 * Usage: node check-runs-facts.ts --sha <sha>
 *
 * Dedup and `ci-app-*` aggregation are `lib/check-runs.ts`'s pure functions —
 * shared with `pr-gate-facts.ts` (task 3.9) so the two scripts cannot drift
 * apart on what "newest" or "not success" means.
 *
 * Output fields (exit 0):
 * - `checks[]` — every check-run on the commit, deduped to the newest per
 *   name (`id`, `name`, `status`, `conclusion`, `startedAt`). The procedure's
 *   own wait loop reads `status` here to tell "still pending" from "done".
 * - `ciApp` — `total` (count of deduped `ci-app-*` check-runs) and
 *   `notSuccess[]` (the ones among those whose `conclusion` is not
 *   `"success"`, including one still in progress, whose `conclusion` is
 *   `null`).
 * - `flakyRepro` — `status` (`"absent"` when no check-run named
 *   `flaky-repro` exists on the commit yet) and `conclusion`.
 *
 * Exit 2: the check-runs call failed (no page could be fetched at all).
 */
import { pathToFileURL } from 'node:url';

import {
  aggregateCiApp,
  dedupeNewestByName,
  type RawCheckRun,
} from '../lib/check-runs.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node check-runs-facts.ts --sha <sha>

Returns the commit's check-runs deduped to the newest per name, ci-app-*
totals/non-success, and the flaky-repro check-run's status/conclusion.
This is a single call — it does not wait or poll.

Output fields (exit 0): checks[] (id, name, status, conclusion, startedAt),
ciApp (total, notSuccess[]), flakyRepro (status, conclusion).
Exit code 2: the check-runs call failed.
`;

export type CliArgs = { readonly sha: string };

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
  if (sha == null) {
    return { kind: 'invalid', reason: '--sha is required' };
  }
  return { kind: 'args', value: { sha } };
};

type RawCheckRunsPage = {
  readonly check_runs: readonly RawCheckRun[];
};

const PER_PAGE = 100;
const FLAKY_REPRO_NAME = 'flaky-repro';

export const run = async (
  ghApi: GhApi,
  args: CliArgs,
): Promise<ScriptResult> => {
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
    return {
      ok: false,
      failure: {
        reason: `could not fetch check-runs for commit ${args.sha}: ${error.message}`,
      },
    };
  }

  const checks = dedupeNewestByName(rawChecks);
  const ciApp = aggregateCiApp(checks);
  const flakyRepro = checks.find((check) => check.name === FLAKY_REPRO_NAME);

  return {
    ok: true,
    facts: {
      checks,
      ciApp,
      flakyRepro:
        flakyRepro == null
          ? { status: 'absent', conclusion: null }
          : { status: flakyRepro.status, conclusion: flakyRepro.conclusion },
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
