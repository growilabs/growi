#!/usr/bin/env node
/**
 * Checks whether the real-data fixtures under `bin/flaky-ci/fixtures/` still
 * match the shape of the live GitHub API response they were captured from
 * (Requirement 1). A fixture's *values* (comment bodies, timestamps, label
 * state, ...) are expected to drift over time and are not interesting here
 * (Requirement 1.3) — only whether the top-level field construction changed.
 *
 * For each `.meta.md` sidecar under `fixtures/{api,lockfile,job-logs}/`,
 * `lib/meta-source.ts` decides what to do with the fixture it documents:
 *   - `synthetic` — hand-built data, excluded entirely from this check
 *     (Requirement 1.4): not counted as checked, not drift, not unchecked.
 *   - `unrecognized` — the `.meta.md` is not written in the one narrow form
 *     this repo can mechanically re-fetch (a `-q` filter, a derived/
 *     constructed value, ...). Reported as `unchecked` rather than silently
 *     skipped (Requirement 5.3).
 *   - `real-checkable` — re-fetched via `lib/gh.ts`'s `GhApi` (`getAll` when
 *     the recorded command carried `--paginate`, `get` otherwise) and
 *     compared against the on-disk fixture with `lib/fixture-shape.ts`. A
 *     `GhError` from that fetch (rate limit, 404, network) is also
 *     `unchecked`, never silently treated as "no drift" (Requirement 5.1).
 *
 * `checked` counts only fixtures that were actually fetched and
 * shape-compared — i.e. `real-checkable` fixtures whose fetch succeeded,
 * whether or not the comparison found drift. It excludes `synthetic`
 * (never a target per Requirement 1.4) and `unchecked` fixtures (fetch
 * failed, or the `.meta.md` could not be recognized — neither of those
 * completed a verification, and Requirement 5.1/5.2 require them to be
 * reported as a distinct "could not be confirmed" bucket, not folded into
 * "checked").
 *
 * Usage: node check-fixture-drift.ts
 *
 * Output fields (exit 0): checked (number), drift (DriftFinding[], each
 * carrying the re-fetched `source` path alongside the diff), unchecked
 * (UncheckedFinding[])
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { computeShape, diffShapes } from '../lib/fixture-shape.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { parseMetaSource } from '../lib/meta-source.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node check-fixture-drift.ts

Scans bin/flaky-ci/fixtures/{api,lockfile,job-logs}/**/*.meta.md, re-fetches
each real-checkable fixture's source via the GitHub API, and reports any
fixture whose response shape (top-level key construction and value types)
no longer matches the one on disk.

Output fields (exit 0): checked (number), drift (DriftFinding[]), unchecked (UncheckedFinding[])
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
      reason: `check-fixture-drift takes no arguments (got ${argv.join(' ')})`,
    };
  }
  return { kind: 'args' };
};

export type DriftFinding = {
  readonly file: string;
  /**
   * The exact `repos/growilabs/growi/...` path that was re-fetched (from
   * `MetaSource`'s `real-checkable.path`), so a reader of the resulting
   * GitHub issue knows which `gh api` call to re-run themselves to
   * investigate the drift.
   */
  readonly source: string;
  readonly diffPaths: readonly string[];
};
export type UncheckedFinding = {
  readonly file: string;
  readonly reason: string;
};
export type DriftResult = {
  readonly checked: number;
  readonly drift: readonly DriftFinding[];
  readonly unchecked: readonly UncheckedFinding[];
};

/** The same 3 directories README.md scopes real-data fixtures to. */
const REAL_DATA_SUBDIRS = ['api', 'lockfile', 'job-logs'] as const;

const META_SUFFIX = '.meta.md';

/**
 * Recursively lists every `*.meta.md` file under REAL_DATA_SUBDIRS, as
 * fixtures-relative POSIX paths.
 */
const listMetaFiles = (fixturesDir: string): string[] => {
  const result: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(META_SUFFIX)) {
        result.push(path.relative(fixturesDir, full).split(path.sep).join('/'));
      }
    }
  };
  for (const subdir of REAL_DATA_SUBDIRS) {
    const subdirPath = path.join(fixturesDir, subdir);
    if (existsSync(subdirPath)) {
      walk(subdirPath);
    }
  }
  return result;
};

/**
 * Core check, factored out from the CLI entrypoint so it can be exercised
 * against a fake `GhApi` and a temporary fixtures tree in tests, instead of
 * making real GitHub calls.
 */
export const checkFixtureDrift = async (
  ghApi: GhApi,
  fixturesDir: string,
): Promise<DriftResult> => {
  const metaFiles = listMetaFiles(fixturesDir);

  let checked = 0;
  const drift: DriftFinding[] = [];
  const unchecked: UncheckedFinding[] = [];

  for (const metaRelPath of metaFiles) {
    const dataRelPath = metaRelPath.slice(0, -META_SUFFIX.length);
    const metaText = readFileSync(path.join(fixturesDir, metaRelPath), 'utf8');
    const source = parseMetaSource(metaText);

    if (source.kind === 'synthetic') {
      continue;
    }

    if (source.kind === 'unrecognized') {
      unchecked.push({ file: dataRelPath, reason: source.reason });
      continue;
    }

    let liveResponse: unknown;
    try {
      if (source.paginate) {
        // biome-ignore lint/performance/noAwaitInLoops: each fixture's fetch is independent, but sequential calls avoid bursting many concurrent `gh api` invocations against GitHub's rate limit.
        liveResponse = await ghApi.getAll(source.path, source.params);
      } else {
        liveResponse = await ghApi.get(source.path, source.params);
      }
    } catch (error) {
      if (!(error instanceof GhError)) {
        // Not a precondition failure this script knows how to name — let it
        // surface as an unexpected exception rather than mislabel it.
        throw error;
      }
      unchecked.push({ file: dataRelPath, reason: error.message });
      continue;
    }

    const onDiskValue = JSON.parse(
      readFileSync(path.join(fixturesDir, dataRelPath), 'utf8'),
    );
    const diffPaths = diffShapes(
      computeShape(onDiskValue),
      computeShape(liveResponse),
    );
    checked += 1;
    if (diffPaths.length > 0) {
      drift.push({ file: dataRelPath, source: source.path, diffPaths });
    }
  }

  return { checked, drift, unchecked };
};

export const run = async (ghApi: GhApi): Promise<ScriptResult> => {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const flakyCiDir = path.join(scriptsDir, '..');
  const fixturesDir = path.join(flakyCiDir, 'fixtures');
  const facts = await checkFixtureDrift(ghApi, fixturesDir);
  return { ok: true, facts };
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
    run(createGhApi()).then(emit);
  }
}
