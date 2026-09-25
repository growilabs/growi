/**
 * Reads the en_US (source language) locale file for every namespace declared
 * in `SyncConfig` and pushes them to the single shared POEditor project via
 * `PoeditorClient.uploadTerms`, in two stages:
 *
 * 1. One combined, deletion-converging upload (`sync_terms` enabled) carrying
 *    every namespace at once. POEditor's `sync_terms` converges the WHOLE
 *    project to the uploaded file, so this must happen exactly once per run —
 *    a converging upload per namespace would make each call delete the
 *    namespaces uploaded before it.
 * 2. One non-destructive upload per namespace (`syncTerms: false`) whose only
 *    purpose is to tag that namespace's terms, so translators can filter the
 *    shared project by namespace.
 *
 * - Reads every namespace file first, then uploads. If any namespace file
 *   fails to read or parse, the whole run aborts and `uploadTerms` is called
 *   zero times — the project must never converge to a partial set of
 *   namespaces.
 * - Uploads run sequentially. The at-least-20-second gap between uploads is
 *   already enforced inside `PoeditorClient.uploadTerms` itself, so this file
 *   must not duplicate that wait.
 * - The POEditor API token is read from `process.env` only in the
 *   process-entrypoint wrapper (`main`), never inside `runPush` itself, so
 *   the orchestration logic stays testable without touching env vars.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { toPoeditorLanguageCode } from './language-code-map.ts';
import {
  combineNamespaceContents,
  wrapSingleNamespace,
} from './namespace-envelope.ts';
import {
  createPoeditorClient,
  type PoeditorApiError,
  type PoeditorClient,
} from './poeditor-client.ts';
import {
  type NamespaceSyncEntry,
  SHARED_POEDITOR_PROJECT_ID,
  SYNC_TARGETS,
} from './sync-config.ts';

/** The language this CLI pushes: en_US is GROWI's source language. */
export const SOURCE_LANGUAGE = 'en_US';

/** Injectable file-reading function, so tests can simulate a read failure without touching the real filesystem. */
export type ReadNamespaceFile = (absolutePath: string) => Promise<string>;

const defaultReadNamespaceFile: ReadNamespaceFile = (absolutePath) =>
  readFile(absolutePath, 'utf-8');

export interface RunPushOptions {
  readonly poeditorClient: PoeditorClient;
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

export type PushResult =
  | { readonly ok: true }
  /** Covers both an unreadable file and one whose content is not valid JSON: either way the namespace's content is unusable and nothing is uploaded. */
  | {
      readonly ok: false;
      readonly reason: 'read_failed';
      readonly failures: readonly NamespaceReadFailure[];
    }
  | {
      readonly ok: false;
      readonly reason: 'combined_upload_failed';
      readonly error: PoeditorApiError;
    }
  | {
      readonly ok: false;
      readonly reason: 'tag_upload_failed';
      readonly namespace: NamespaceSyncEntry['namespace'];
      readonly error: PoeditorApiError;
    };

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

type NamespaceSource = {
  readonly namespace: NamespaceSyncEntry['namespace'];
  readonly content: Record<string, unknown>;
};

type ReadOutcome =
  | { readonly source: NamespaceSource; readonly failure?: undefined }
  | { readonly source?: undefined; readonly failure: NamespaceReadFailure };

const readNamespaceSource = async (
  target: NamespaceSyncEntry,
  baseDir: string,
  readNamespaceFile: ReadNamespaceFile,
): Promise<ReadOutcome> => {
  const filePath = target.localeFilePath(SOURCE_LANGUAGE);
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
 * Reads every declared namespace's en_US file first, then uploads. Reading
 * everything before uploading anything is what makes the "abort before any
 * upload" guarantee hold cleanly: there is no interleaved read+upload step
 * where a later read failure could leave the shared project already converged
 * to an incomplete set of namespaces.
 */
export const runPush = async (options: RunPushOptions): Promise<PushResult> => {
  const targets = options.targets ?? SYNC_TARGETS;
  const readNamespaceFile =
    options.readNamespaceFile ?? defaultReadNamespaceFile;
  const baseDir = options.baseDir ?? APP_ROOT;

  const readOutcomes = await Promise.all(
    targets.map((target) =>
      readNamespaceSource(target, baseDir, readNamespaceFile),
    ),
  );

  const readFailures = readOutcomes
    .map((outcome) => outcome.failure)
    .filter((failure) => failure != null);

  if (readFailures.length > 0) {
    return { ok: false, reason: 'read_failed', failures: readFailures };
  }

  // Safe: readFailures.length === 0 above means every outcome carries a source.
  const sources = readOutcomes.map(
    (outcome) => outcome.source as NamespaceSource,
  );

  // POEditor rejects GROWI's locale codes (`en_US` -> "Wrong language code"),
  // so the conversion happens here, at the API boundary — everything above
  // (file paths, namespace handling) keeps using GROWI's own code.
  const language = toPoeditorLanguageCode(SOURCE_LANGUAGE);

  // Stage 1: converge the whole project to every namespace at once. Exactly
  // one converging upload per run — see this file's header comment.
  const combinedResult = await options.poeditorClient.uploadTerms({
    projectId: SHARED_POEDITOR_PROJECT_ID,
    language,
    fileContent: JSON.stringify(combineNamespaceContents(sources)),
    // en_US is the authoritative source: a wording change to an existing
    // key must always replace POEditor's copy (research.md's
    // overwrite-default Decision -- POEditor otherwise keeps the old value).
    overwrite: true,
  });
  if (!combinedResult.ok) {
    return {
      ok: false,
      reason: 'combined_upload_failed',
      error: combinedResult.error,
    };
  }

  // Stage 2: tag each namespace's terms without deleting anything. Stops at
  // the first failure, symmetric with the read-failure path above, so the run
  // never silently leaves some namespaces tagged and others not.
  for (const source of sources) {
    // Must run sequentially, not via Promise.all — PoeditorClient enforces
    // a 20-second gap between consecutive uploadTerms calls, which only
    // holds if each call starts after the previous one settles.
    // biome-ignore lint/performance/noAwaitInLoops: sequential by design, see comment above.
    const tagResult = await options.poeditorClient.uploadTerms({
      projectId: SHARED_POEDITOR_PROJECT_ID,
      language,
      fileContent: JSON.stringify(
        wrapSingleNamespace(source.namespace, source.content),
      ),
      syncTerms: false,
      tag: source.namespace,
    });
    if (!tagResult.ok) {
      return {
        ok: false,
        reason: 'tag_upload_failed',
        namespace: source.namespace,
        error: tagResult.error,
      };
    }
  }

  return { ok: true };
};

const formatFailure = (result: Extract<PushResult, { ok: false }>): string => {
  switch (result.reason) {
    case 'read_failed':
      return `Aborted: failed to read the following namespace file(s), no upload was attempted:\n${result.failures
        .map((f) => `  - ${f.namespace} (${f.filePath}): ${f.message}`)
        .join('\n')}`;
    case 'combined_upload_failed':
      return `Failed: the combined upload of all namespaces to POEditor failed, no namespace was tagged: ${JSON.stringify(result.error)}`;
    case 'tag_upload_failed':
      return `Failed: the combined upload succeeded but tagging the '${result.namespace}' namespace failed, so the remaining namespaces were not tagged: ${JSON.stringify(result.error)}`;
  }
};

/**
 * Process-entrypoint wrapper: reads the POEditor API token from
 * `process.env`, runs `runPush`, prints the outcome, and sets a non-zero
 * exit code on failure. Kept separate from `runPush` so the orchestration
 * logic stays testable without an env var or a real process exit.
 */
export const main = async (): Promise<void> => {
  const apiToken = process.env.POEDITOR_API_TOKEN;
  if (apiToken == null || apiToken === '') {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.error(
      'Cannot push to POEditor: POEDITOR_API_TOKEN is not set in the environment.',
    );
    process.exitCode = 1;
    return;
  }

  const poeditorClient = createPoeditorClient({ apiToken });
  const result = await runPush({ poeditorClient });

  if (result.ok) {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.log(
      `Pushed ${SOURCE_LANGUAGE} to the shared POEditor project: 1 combined upload covering ${SYNC_TARGETS.length} namespace(s), then ${SYNC_TARGETS.length} tagging upload(s).`,
    );
    return;
  }

  // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
  console.error(formatFailure(result));
  process.exitCode = 1;
};

// Only run when executed directly (`node tools/i18n-sync/push-source.ts`),
// not when imported by tests -- otherwise importing this module for
// `runPush` would attempt to read `process.env.POEDITOR_API_TOKEN` and run
// the real entrypoint as a side effect of the import itself.
if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
