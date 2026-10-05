#!/usr/bin/env node
/**
 * Package-name overlap between a PR's `pnpm-lock.yaml` diff and a failure's
 * stack trace — the fact `detect-flaky-ci/SKILL.md`'s ① check uses to decide
 * whether a lockfile change already explains a failure well enough that ①
 * should not fire.
 *
 * Replaces the hand-applied "Package names from the lockfile patch" /
 * "Package names from the failure's stack trace" tables in the procedure
 * (`lib/lockfile.ts` carries the two rule pairs); the procedure keeps the
 * judgment of whether a non-empty `overlap` should suppress ① and how to
 * word the resulting note.
 *
 * Usage: node lockfile-overlap.ts --sha <sha> --pr <number> --log-excerpt-file <path>
 *
 * `--pr` identifies which PR's changed files to fetch; `--sha` is not used to
 * fetch anything (the PR's current file diff is what the procedure already
 * has in hand) but is carried through into the exit-2 failure reason so a
 * human reading routine output can tell which failure's check this was.
 *
 * Output fields (exit 0): overlap[], patchPackages[], logPackages[]. A PR
 * that doesn't touch `pnpm-lock.yaml` (the common case) is exit 0 too, with
 * empty overlap[]/patchPackages[] — that is a fact for ① to read, not a
 * measurement failure.
 * Exit 2: the PR's changed files could not be fetched, or the log excerpt
 * file could not be read — i.e. the fetch itself failed.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { intersect, packagesInLog, packagesInPatch } from '../lib/lockfile.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node lockfile-overlap.ts --sha <sha> --pr <number> --log-excerpt-file <path>

Compares package names touched by PR --pr's pnpm-lock.yaml diff against
package names appearing in the failure log excerpt at --log-excerpt-file.

Output fields (exit 0): overlap[], patchPackages[], logPackages[]. A PR that
doesn't touch pnpm-lock.yaml is exit 0 too, with empty overlap/patchPackages.
Exit code 2: PR files could not be fetched, or the log excerpt file could
not be read.
`;

export type CliArgs = {
  readonly sha: string;
  readonly pr: string;
  readonly logExcerptFile: string;
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
  const pr = flagValue(argv, 'pr');
  const logExcerptFile = flagValue(argv, 'log-excerpt-file');
  if (sha == null || pr == null || logExcerptFile == null) {
    return {
      kind: 'invalid',
      reason: '--sha, --pr and --log-excerpt-file are all required',
    };
  }
  return { kind: 'args', value: { sha, pr, logExcerptFile } };
};

type PrFile = { readonly filename: string; readonly patch?: string };

export const run = async (
  ghApi: GhApi,
  readFile: (path: string) => string,
  args: CliArgs,
): Promise<ScriptResult> => {
  let files: readonly PrFile[];
  try {
    files = await ghApi.getAll<PrFile>(
      `repos/growilabs/growi/pulls/${args.pr}/files`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      // Not a precondition failure this script knows how to name — let it
      // surface as an unexpected exception (exit 1) rather than mislabel it.
      throw error;
    }
    return {
      ok: false,
      failure: {
        reason: `could not fetch changed files for PR #${args.pr} (commit ${args.sha}): ${error.message}`,
      },
    };
  }

  let logExcerpt: string;
  try {
    logExcerpt = readFile(args.logExcerptFile);
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: `could not read --log-excerpt-file ${args.logExcerptFile}: ${(error as Error).message}`,
      },
    };
  }

  const logPackages = packagesInLog(logExcerpt);

  // Not touching pnpm-lock.yaml at all is the common case (most failing PRs
  // never touch the lockfile) — that is a fact for ① to read ("this PR
  // doesn't explain the failure via a dependency bump"), not a measurement
  // failure. Reserve exit 2 for cases where the fetch itself didn't work.
  const lockfileFile = files.find((file) => file.filename === 'pnpm-lock.yaml');
  if (lockfileFile?.patch == null) {
    return {
      ok: true,
      facts: {
        overlap: [],
        patchPackages: [],
        logPackages: [...logPackages].sort(),
      },
    };
  }

  const patchPackages = packagesInPatch(lockfileFile.patch);
  const overlap = intersect(patchPackages, logPackages);

  return {
    ok: true,
    facts: {
      overlap: [...overlap].sort(),
      patchPackages: [...patchPackages].sort(),
      logPackages: [...logPackages].sort(),
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
    run(createGhApi(), (path) => readFileSync(path, 'utf8'), parsed.value).then(
      emit,
    );
  }
}
