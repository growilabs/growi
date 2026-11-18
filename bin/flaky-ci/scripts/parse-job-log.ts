#!/usr/bin/env node
/**
 * The facts `detect-flaky-ci/SKILL.md` Step 2 and Step 3 read out of one CI
 * job log: vitest failure blocks, each Playwright run's counts with its flaky
 * and failed test lists (every listed test carrying its identity key), and
 * which failures match the infrastructure-noise denylist.
 *
 * Replaces the literal-pattern greps and the ANSI `sed` the procedure used to
 * spell out. Every judgment stays there: whether a failure gets a per-test or
 * a job-level identity, whether it is confirmed or an observation, whether
 * the denylist should be widened, and where collateral and cascaded failures
 * are folded.
 *
 * The log arrives on **stdin**, never as a path or an id, so the two fetch
 * routes converge here (Requirement 3.2): `gh api --allow-escape-sequences …`
 * redirected to a file in the devcontainer, and an
 * `mcp__github__get_job_logs` result written to a file with `Write` in the
 * cloud routine. This script cannot call an MCP tool, and it does not need to.
 *
 * Usage: node parse-job-log.ts < job.log
 *
 * Output fields (exit 0): vitest.failBlocks[], playwright.runs[] (empty when
 * the log carried no Playwright summary), denylistHits[].
 * Exit 2: stdin was empty or whitespace only — nothing was measured, which
 * must not be reported as "no failures".
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  INFRA_NOISE_PATTERNS,
  match as matchDenylist,
} from '../lib/denylist.ts';
import { buildPlaywrightKey } from '../lib/identity.ts';
import {
  extractFailBlocks,
  extractPlaywrightRuns,
  type PlaywrightListedTest,
  type PlaywrightTestList,
  type Summary,
} from '../lib/job-log.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node parse-job-log.ts < job.log

Reads one CI job log on stdin (the same text whether it was fetched with
gh api --allow-escape-sequences or written from an MCP get_job_logs result)
and returns the facts Step 2 and Step 3 of detect-flaky-ci read from it.

Output fields (exit 0):
  vitest.failBlocks[]        project, specPath, testTitle, sharedSetupHook, excerpt
  playwright.runs[]          one element per Playwright run in the log, in
                             printed order (an empty array when the log has no
                             Playwright summary):
                               counts   failed / flaky / passed / skipped
                               flaky    { kind: "read", tests[] } or
                                        { kind: "unreadable", reason }
                               failed   same shape as flaky
                               excerpt  the lines read as this run's summary
                             each test in a "read" list: project, specPath,
                             testTitle, identityKey
  denylistHits[]             blockIndex, specPath, testTitle, pattern, needle,
                             scope ("job" only inside a shared setup hook)

Exit code 2: stdin was empty or whitespace only.
`;

export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'args' }
  | { readonly kind: 'invalid'; readonly reason: string };

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  if (argv.length > 0) {
    return {
      kind: 'invalid',
      reason: `parse-job-log takes no arguments; the log is read from stdin (got ${argv.join(' ')})`,
    };
  }
  return { kind: 'args' };
};

export type ListWithKeys =
  | {
      readonly kind: 'read';
      readonly tests: readonly (PlaywrightListedTest & {
        readonly identityKey: string;
      })[];
    }
  | Extract<PlaywrightTestList, { kind: 'unreadable' }>;

export type ParseJobLogPlaywright = {
  readonly runs: readonly {
    readonly counts: Summary;
    readonly flaky: ListWithKeys;
    readonly failed: ListWithKeys;
    readonly excerpt: string;
  }[];
};

const withKeys = (list: PlaywrightTestList): ListWithKeys =>
  list.kind === 'unreadable'
    ? list
    : {
        kind: 'read',
        tests: list.tests.map((test) => ({
          ...test,
          identityKey: buildPlaywrightKey(test),
        })),
      };

export const run = (logText: string): ScriptResult => {
  if (logText.trim() === '') {
    return {
      ok: false,
      failure: {
        reason:
          'stdin was empty: no job log to parse (an empty result is not "no failures")',
      },
    };
  }

  const failBlocks = extractFailBlocks(logText);

  // One hit per failure, carrying the index of the block it came from, so the
  // procedure can tie it back to the failure it drops. A hit whose scope is
  // "job" is the shared-setup-hook exception and reaches every failure in
  // this log — that reading stays in the procedure.
  const denylistHits = failBlocks.flatMap((block, blockIndex) => {
    // The list is declared once, in `lib/denylist.ts`, and handed in here —
    // the script matches, it does not own what to match against.
    const hit = matchDenylist(block.excerpt, INFRA_NOISE_PATTERNS);
    return hit == null
      ? []
      : [
          {
            blockIndex,
            specPath: block.specPath,
            testTitle: block.testTitle,
            pattern: hit.pattern,
            needle: hit.needle,
            scope: hit.scope,
          },
        ];
  });

  const playwright: ParseJobLogPlaywright = {
    runs: extractPlaywrightRuns(logText).map((playwrightRun) => ({
      counts: playwrightRun.counts,
      flaky: withKeys(playwrightRun.flaky),
      failed: withKeys(playwrightRun.failed),
      excerpt: playwrightRun.excerpt,
    })),
  };

  return {
    ok: true,
    facts: {
      vitest: { failBlocks },
      playwright,
      denylistHits,
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
    // Reading fd 0 synchronously keeps the whole log in one string before any
    // parsing starts; a partially-read log would silently look like a log
    // with fewer failures.
    let logText: string;
    try {
      logText = readFileSync(0, 'utf8');
    } catch (error) {
      emit({
        ok: false,
        failure: {
          reason: `could not read stdin: ${(error as Error).message}`,
        },
      });
    }
    emit(run(logText));
  }
}
