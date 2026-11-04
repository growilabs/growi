/**
 * One-time (or re-run-if-needed) upload of a single non-source language's
 * EXISTING repository translations into the shared POEditor project.
 *
 * Needed because `PushSourceSync` only ever uploads `en_US`. A freshly
 * provisioned (or re-provisioned) POEditor project therefore starts at 0%
 * translated for `ja_JP`/`zh_CN`/`fr_FR`/`ko_KR` even though the repository
 * already has real translations for them
 * (`docs/i18n-community-translation-setup.md` §2.3).
 *
 * Deliberately non-destructive (`syncTerms: false`, no `tag`) and restricted
 * to the repository's own `en_US` key set (see research.md's
 * `sync_terms`-addition Decision): this must never create a term the
 * repository's `en_US` files don't have, delete a term, or touch namespace
 * tags. Term existence/deletion and tagging are `PushSourceSync`'s job
 * alone; this module only ever fills in translations for terms `en_US`
 * already established there.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { filterToKnownKeys } from './diff-classifier.ts';
import { toPoeditorLanguageCode } from './language-code-map.ts';
import { combineNamespaceContents } from './namespace-envelope.ts';
import {
  createPoeditorClient,
  type PoeditorApiError,
  type PoeditorClient,
} from './poeditor-client.ts';
import { SOURCE_LANGUAGE } from './push-source.ts';
import {
  type NamespaceSyncEntry,
  SHARED_POEDITOR_PROJECT_ID,
  SYNC_TARGETS,
} from './sync-config.ts';

/** Injectable file-reading function, so tests can simulate a read failure without touching the real filesystem. */
export type ReadNamespaceFile = (absolutePath: string) => Promise<string>;

const defaultReadNamespaceFile: ReadNamespaceFile = (absolutePath) =>
  readFile(absolutePath, 'utf-8');

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface RunSeedOptions {
  readonly poeditorClient: PoeditorClient;
  /** The GROWI locale code to seed, e.g. "ja_JP". Must be a non-source language. */
  readonly language: string;
  /** Declared namespace -> locale file mapping. Defaults to the real `SYNC_TARGETS`. */
  readonly targets?: readonly NamespaceSyncEntry[];
  /** Injectable file reader. Defaults to reading the real filesystem. */
  readonly readNamespaceFile?: ReadNamespaceFile;
  /**
   * Base directory the namespace-declared locale file paths are resolved
   * against (they are relative to `apps/app/`, per SyncConfig's doc
   * comment). Defaults to this file's own package root.
   */
  readonly baseDir?: string;
}

type NamespaceReadFailure = {
  readonly namespace: NamespaceSyncEntry['namespace'];
  readonly filePath: string;
  readonly message: string;
};

export type SeedResult =
  | { readonly ok: true; readonly skippedKeyCount: number }
  /** Covers both an unreadable file and one whose content is not valid JSON: either way the namespace's content is unusable and nothing is uploaded. */
  | {
      readonly ok: false;
      readonly reason: 'read_failed';
      readonly failures: readonly NamespaceReadFailure[];
    }
  | {
      readonly ok: false;
      readonly reason: 'upload_failed';
      readonly error: PoeditorApiError;
    };

type NamespaceSource = {
  readonly namespace: NamespaceSyncEntry['namespace'];
  readonly content: Record<string, unknown>;
};

type ReadOutcome =
  | { readonly source: NamespaceSource; readonly failure?: undefined }
  | { readonly source?: undefined; readonly failure: NamespaceReadFailure };

const readNamespaceSource = async (
  target: NamespaceSyncEntry,
  language: string,
  baseDir: string,
  readNamespaceFile: ReadNamespaceFile,
): Promise<ReadOutcome> => {
  const filePath = target.localeFilePath(language);
  try {
    const fileContent = await readNamespaceFile(path.join(baseDir, filePath));
    return {
      source: {
        namespace: target.namespace,
        content: JSON.parse(fileContent) as Record<string, unknown>,
      },
    };
  } catch (error) {
    return {
      failure: {
        namespace: target.namespace,
        filePath,
        message: (error as Error).message ?? 'unknown error',
      },
    };
  }
};

/**
 * Reads every declared namespace's file for `options.language` and for
 * `SOURCE_LANGUAGE` first, then uploads once. Reading everything before
 * uploading anything mirrors `PushSourceSync.runPush`'s "abort before any
 * upload" guarantee.
 */
export const runSeed = async (options: RunSeedOptions): Promise<SeedResult> => {
  const targets = options.targets ?? SYNC_TARGETS;
  const readNamespaceFile =
    options.readNamespaceFile ?? defaultReadNamespaceFile;
  const baseDir = options.baseDir ?? APP_ROOT;

  const [languageOutcomes, sourceOutcomes] = await Promise.all([
    Promise.all(
      targets.map((target) =>
        readNamespaceSource(
          target,
          options.language,
          baseDir,
          readNamespaceFile,
        ),
      ),
    ),
    Promise.all(
      targets.map((target) =>
        readNamespaceSource(
          target,
          SOURCE_LANGUAGE,
          baseDir,
          readNamespaceFile,
        ),
      ),
    ),
  ]);

  const readFailures = [...languageOutcomes, ...sourceOutcomes]
    .map((outcome) => outcome.failure)
    .filter((failure) => failure != null);

  if (readFailures.length > 0) {
    return { ok: false, reason: 'read_failed', failures: readFailures };
  }

  // Safe: readFailures.length === 0 above means every outcome carries a source.
  const sourceContentByNamespace = new Map(
    sourceOutcomes.map((outcome) => [
      (outcome.source as NamespaceSource).namespace,
      (outcome.source as NamespaceSource).content,
    ]),
  );
  let skippedKeyCount = 0;
  const sources = languageOutcomes.map((outcome) => {
    const { namespace, content } = outcome.source as NamespaceSource;
    // Restricts the upload to en_US's own key set (research.md's
    // `sync_terms`-addition Decision): `syncTerms: false` prevents
    // deletion but does NOT prevent POEditor from creating a term for a
    // key that only exists in `options.language`'s file.
    const filtered = filterToKnownKeys(
      sourceContentByNamespace.get(namespace) ?? {},
      content,
    );
    skippedKeyCount += countLeaves(content) - countLeaves(filtered);
    return { namespace, content: filtered };
  });

  // POEditor rejects GROWI's locale codes, so the conversion happens here,
  // at the API boundary -- everything above (file paths, namespace
  // handling) keeps using GROWI's own code.
  const language = toPoeditorLanguageCode(options.language);

  // `uploadTerms` never sends an `overwrite` param, so "safe to re-run"
  // relies on POEditor's server-side default not overwriting a translation
  // a contributor has since entered. If `uploadTerms` ever grows an
  // `overwrite` option, this call must not opt into overwriting.
  const uploadResult = await options.poeditorClient.uploadTerms({
    projectId: SHARED_POEDITOR_PROJECT_ID,
    language,
    fileContent: JSON.stringify(combineNamespaceContents(sources)),
    syncTerms: false,
  });
  if (!uploadResult.ok) {
    return { ok: false, reason: 'upload_failed', error: uploadResult.error };
  }

  return { ok: true, skippedKeyCount };
};

/** Counts the leaf (non-object) values in a nested locale object. */
const countLeaves = (obj: Readonly<Record<string, unknown>>): number => {
  let count = 0;
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      count += countLeaves(value as Record<string, unknown>);
      continue;
    }
    count += 1;
  }
  return count;
};

const formatFailure = (result: Extract<SeedResult, { ok: false }>): string => {
  switch (result.reason) {
    case 'read_failed':
      return `Aborted: failed to read the following namespace file(s), no upload was attempted:\n${result.failures
        .map((f) => `  - ${f.namespace} (${f.filePath}): ${f.message}`)
        .join('\n')}`;
    case 'upload_failed':
      return `Failed: the upload to POEditor failed: ${JSON.stringify(result.error)}`;
  }
};

/**
 * The 4 non-source languages this CLI can seed. Kept in sync by hand with
 * `pull-translations.ts`'s `NON_SOURCE_LANGUAGES` -- not imported from there,
 * since importing `pull-translations.ts` here would pull in its GitHub
 * adapters and other pull-only dependencies for a script that has nothing to
 * do with them.
 */
export const SEEDABLE_LANGUAGES = ['ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'] as const;

/**
 * Process-entrypoint wrapper: reads the POEditor API token and the target
 * language from the environment, runs `runSeed`, prints the outcome, and
 * sets a non-zero exit code on failure. Kept separate from `runSeed` so the
 * orchestration logic stays testable without an env var or a real process
 * exit.
 *
 * Seeds exactly one language per invocation (`I18N_SYNC_SEED_LANGUAGE`),
 * rather than looping over all 4 in-process, so a maintainer can re-run a
 * single failed language without re-uploading the ones that already
 * succeeded, and so the 20-second per-upload throttle
 * (`PoeditorClient.uploadTerms`) never has to be reasoned about across
 * multiple languages in one process.
 */
export const main = async (): Promise<void> => {
  const apiToken = process.env.POEDITOR_API_TOKEN;
  if (apiToken == null || apiToken === '') {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.error(
      'Cannot seed POEditor: POEDITOR_API_TOKEN is not set in the environment.',
    );
    process.exitCode = 1;
    return;
  }

  const language = process.env.I18N_SYNC_SEED_LANGUAGE;
  if (
    language == null ||
    !(SEEDABLE_LANGUAGES as readonly string[]).includes(language)
  ) {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.error(
      `Cannot seed POEditor: I18N_SYNC_SEED_LANGUAGE must be one of ${SEEDABLE_LANGUAGES.join(', ')} (got: ${JSON.stringify(language)}).`,
    );
    process.exitCode = 1;
    return;
  }

  const poeditorClient = createPoeditorClient({ apiToken });
  const result = await runSeed({ poeditorClient, language });

  if (result.ok) {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.log(
      `Seeded ${language}'s existing translations into the shared POEditor project (${SYNC_TARGETS.length} namespace(s), non-destructive). Skipped ${result.skippedKeyCount} key(s) absent from en_US.`,
    );
    return;
  }

  // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
  console.error(formatFailure(result));
  process.exitCode = 1;
};

// Only run when executed directly (`node tools/i18n-sync/seed-existing-translations.ts`),
// not when imported by tests -- otherwise importing this module for
// `runSeed` would attempt to read `process.env` and run the real entrypoint
// as a side effect of the import itself.
if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
