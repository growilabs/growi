/**
 * Exports each namespace x non-source language combination's translations
 * from POEditor, classifies each combination against the current repository
 * content via `DiffClassifier`, and groups the results into exactly two
 * collections: every combination that only changed translation values goes
 * into one pull request, and every combination that added or removed a key
 * goes into a separate one — a structural change must never ride along in
 * the same pull request as a translation-only one.
 *
 * `collectClassifications` builds exactly that grouping as data: every
 * `translation_only` combination goes into `translationOnly`, every
 * `structural` combination goes into `structural`, and `no_change`
 * combinations are excluded from both (nothing to report, not an error).
 * The two groups are modeled as *different element types*
 * (`TranslationOnlyCombination` / `StructuralCombination`) so a structural
 * result cannot be pushed into the translation-only group (or vice versa)
 * without a type error, not just a runtime check. A combination whose
 * POEditor export failed to parse as JSON (`invalid_json`) is excluded from
 * both groups too, but — unlike a read/export failure — does not abort the
 * run; it is reported separately via the result's `skipped` list.
 *
 * `applyTranslationOnlyChanges` then takes the `translationOnly` group and
 * carries it all the way to an approved, auto-mergeable PR. The `structural`
 * group instead goes through `applyStructuralChanges`, whose PR always
 * awaits human review.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classify } from './diff-classifier.ts';
import {
  createApprovalReviewer,
  createBaseRefResolver,
  createI18nLintGate,
  createStructuralPrPublisher,
  createTranslationOnlyPrPublisher,
} from './github-adapters.ts';
import {
  createPoeditorClient,
  type PoeditorApiError,
  type PoeditorClient,
} from './poeditor-client.ts';
import { type NamespaceSyncEntry, SYNC_TARGETS } from './sync-config.ts';

/**
 * The 4 non-source languages this CLI pulls translations for. en_US is
 * GROWI's source language, pushed (not pulled) by `PushSourceSync`.
 */
export const NON_SOURCE_LANGUAGES = [
  'ja_JP',
  'zh_CN',
  'fr_FR',
  'ko_KR',
] as const;

/** Injectable file-reading function, so tests can simulate a read failure without touching the real filesystem. */
export type ReadNamespaceFile = (absolutePath: string) => Promise<string>;

const defaultReadNamespaceFile: ReadNamespaceFile = (absolutePath) =>
  readFile(absolutePath, 'utf-8');

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface CollectClassificationsOptions {
  readonly poeditorClient: PoeditorClient;
  /** Declared namespace -> POEditor project mapping. Defaults to the real `SYNC_TARGETS`. */
  readonly targets?: readonly NamespaceSyncEntry[];
  /** Non-source languages to pull. Defaults to the real `NON_SOURCE_LANGUAGES`. */
  readonly languages?: readonly string[];
  /** Injectable file reader for the "before" (currently committed) content. Defaults to reading the real filesystem. */
  readonly readNamespaceFile?: ReadNamespaceFile;
  /**
   * Base directory the namespace-declared locale file paths are resolved
   * against (they are relative to `apps/app/`, per SyncConfig's doc
   * comment). Defaults to this file's own package root.
   */
  readonly baseDir?: string;
}

export interface TranslationOnlyCombination {
  readonly namespace: NamespaceSyncEntry['namespace'];
  readonly language: string;
  readonly changedKeys: readonly string[];
  /**
   * The locale file this combination's `before` content was read from — the
   * same absolute path `applyTranslationOnlyChanges` writes back to, so the
   * file that gets overwritten is provably the file that was classified.
   */
  readonly absoluteFilePath: string;
  /**
   * The exported POEditor content exactly as `DiffClassifier` saw it.
   *
   * Carrying it here (rather than re-exporting at apply time) is a
   * correctness requirement, not an optimization: POEditor is a live system
   * where a contributor can add or remove a term at any moment, so a second
   * export could return content with a *different* key set than the one
   * classified as `translation_only` — and that content would then take the
   * auto-merge path with no human review, even though it might in fact
   * contain a structural change.
   */
  readonly content: Readonly<Record<string, unknown>>;
}

export interface StructuralCombination {
  readonly namespace: NamespaceSyncEntry['namespace'];
  readonly language: string;
  readonly addedKeys: readonly string[];
  readonly removedKeys: readonly string[];
  /**
   * The locale file this combination's `before` content was read from, and
   * `applyStructuralChanges` writes back to.
   *
   * Deliberately named differently from `TranslationOnlyCombination`'s
   * `absoluteFilePath`: `StructuralCombination` and `TranslationOnlyCombination`
   * are already distinct types, so nothing type-checks a swap between them,
   * but matching field names would still let a careless refactor rename one
   * type to the other without a compile error. Different names make that
   * refactor fail loudly instead.
   */
  readonly filePath: string;
  /**
   * The exported POEditor content exactly as `DiffClassifier` saw it -- see
   * `TranslationOnlyCombination.content`'s doc comment for why this must
   * travel with the combination rather than being re-exported at apply
   * time. Named `exportedContent` (not `content`) for the same reason as
   * `filePath` above.
   */
  readonly exportedContent: Readonly<Record<string, unknown>>;
}

type CombinationFailure =
  | {
      readonly namespace: NamespaceSyncEntry['namespace'];
      readonly language: string;
      readonly reason: 'read_failed';
      readonly message: string;
    }
  | {
      readonly namespace: NamespaceSyncEntry['namespace'];
      readonly language: string;
      readonly reason: 'export_failed';
      readonly error: PoeditorApiError;
    }
  | {
      readonly namespace: NamespaceSyncEntry['namespace'];
      readonly language: string;
      readonly reason: 'invalid_json';
      readonly message: string;
    };

/** The subset of `CombinationFailure` that is surfaced but does not abort the run. */
type InvalidJsonFailure = Extract<
  CombinationFailure,
  { reason: 'invalid_json' }
>;

/** The subset of `CombinationFailure` (read/export failures) that aborts the whole run. */
type AbortingFailure = Exclude<CombinationFailure, InvalidJsonFailure>;

export type CollectClassificationsResult =
  | {
      readonly ok: true;
      readonly translationOnly: readonly TranslationOnlyCombination[];
      readonly structural: readonly StructuralCombination[];
      /**
       * (namespace, language) combinations excluded from classification
       * because the POEditor export content failed to JSON.parse. Unlike
       * `read_failed`/`export_failed`, this does not abort the run: export
       * is read-only and never mutates the repository, so a single
       * malformed combination is tolerated rather than blocking the other
       * (up to 11) combinations.
       */
      readonly skipped: readonly InvalidJsonFailure[];
    }
  | {
      readonly ok: false;
      readonly failures: readonly AbortingFailure[];
    };

/**
 * One (namespace, language) combination's raw before/after read, prior to
 * classification. `before`/`after` are `undefined` exactly when `failure`
 * is set, and non-undefined otherwise (never partially populated).
 */
interface CombinationInput {
  readonly namespace: NamespaceSyncEntry['namespace'];
  readonly language: string;
  /** Absolute path of the locale file `before` was read from. */
  readonly absoluteFilePath: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly failure?: CombinationFailure;
}

const safeJsonParse = (
  namespace: NamespaceSyncEntry['namespace'],
  language: string,
  content: string,
):
  | { value: Readonly<Record<string, unknown>> }
  | { failure: CombinationFailure } => {
  try {
    return { value: JSON.parse(content) as Readonly<Record<string, unknown>> };
  } catch (error) {
    return {
      failure: {
        namespace,
        language,
        reason: 'invalid_json',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

/**
 * Reads the "before" (currently committed) content and exports the "after"
 * (POEditor) content for a single (namespace, language) combination. Reads
 * and the export call run concurrently since they are independent I/O
 * operations on unrelated systems; only `PoeditorClient.uploadTerms`
 * (a different method, used by `PushSourceSync`) is subject to POEditor's
 * upload rate limit — `exportTranslations` is not.
 */
interface ReadCombinationOptions {
  readonly target: NamespaceSyncEntry;
  readonly language: string;
  readonly readNamespaceFile: ReadNamespaceFile;
  readonly poeditorClient: PoeditorClient;
  readonly baseDir: string;
}

const readCombination = async ({
  target,
  language,
  readNamespaceFile,
  poeditorClient,
  baseDir,
}: ReadCombinationOptions): Promise<CombinationInput> => {
  const { namespace } = target;
  const absolutePath = path.join(baseDir, target.localeFilePath(language));

  const [beforeResult, afterResult] = await Promise.all([
    readNamespaceFile(absolutePath)
      .then((content) => ({ content }))
      .catch((error: unknown) => ({
        failure: {
          namespace,
          language,
          reason: 'read_failed' as const,
          message: error instanceof Error ? error.message : String(error),
        },
      })),
    poeditorClient.exportTranslations({
      projectId: target.poeditorProjectId,
      language,
    }),
  ]);

  if ('failure' in beforeResult) {
    return {
      namespace,
      language,
      absoluteFilePath: absolutePath,
      failure: beforeResult.failure,
    };
  }
  if (!afterResult.ok) {
    return {
      namespace,
      language,
      absoluteFilePath: absolutePath,
      failure: {
        namespace,
        language,
        reason: 'export_failed',
        error: afterResult.error,
      },
    };
  }

  const beforeParsed = safeJsonParse(namespace, language, beforeResult.content);
  if ('failure' in beforeParsed) {
    return {
      namespace,
      language,
      absoluteFilePath: absolutePath,
      failure: beforeParsed.failure,
    };
  }
  const afterParsed = safeJsonParse(namespace, language, afterResult.value);
  if ('failure' in afterParsed) {
    return {
      namespace,
      language,
      absoluteFilePath: absolutePath,
      failure: afterParsed.failure,
    };
  }

  return {
    namespace,
    language,
    absoluteFilePath: absolutePath,
    before: beforeParsed.value,
    after: afterParsed.value,
  };
};

/**
 * For every (namespace, language) combination, reads the current repository
 * content and exports the POEditor content, classifies the pair via
 * `DiffClassifier.classify`, then groups the classified combinations into
 * `translationOnly` / `structural` (see this file's header comment).
 *
 * Mirrors `PushSourceSync.runPush`'s all-or-nothing error handling: if any
 * combination fails to read the current repository file (`read_failed`) or
 * export from POEditor (`export_failed`), the whole run reports failure and
 * no grouping is returned, so a caller can never build a PR out of a
 * partial result.
 *
 * `invalid_json` (the exported content fails to `JSON.parse`) is the one
 * exception: export is read-only and never mutates the repository, so it
 * tolerates a single malformed combination rather than aborting. That
 * combination alone is excluded from `translationOnly`/`structural` and
 * reported via `skipped`; the rest of the run proceeds and groups normally.
 */
export const collectClassifications = async (
  options: CollectClassificationsOptions,
): Promise<CollectClassificationsResult> => {
  const targets = options.targets ?? SYNC_TARGETS;
  const languages = options.languages ?? NON_SOURCE_LANGUAGES;
  const readNamespaceFile =
    options.readNamespaceFile ?? defaultReadNamespaceFile;
  const baseDir = options.baseDir ?? APP_ROOT;

  const combinationInputs = await Promise.all(
    targets.flatMap((target) =>
      languages.map((language) =>
        readCombination({
          target,
          language,
          readNamespaceFile,
          poeditorClient: options.poeditorClient,
          baseDir,
        }),
      ),
    ),
  );

  // `read_failed` / `export_failed` still abort the whole run. `invalid_json`
  // is handled separately below: it only excludes its own combination and
  // lets the others continue.
  const abortingFailures = combinationInputs
    .map((input) => input.failure)
    .filter(
      (failure): failure is AbortingFailure =>
        failure != null && failure.reason !== 'invalid_json',
    );

  if (abortingFailures.length > 0) {
    return { ok: false, failures: abortingFailures };
  }

  const skipped = combinationInputs
    .map((input) => input.failure)
    .filter(
      (failure): failure is InvalidJsonFailure =>
        failure != null && failure.reason === 'invalid_json',
    );

  const translationOnly: TranslationOnlyCombination[] = [];
  const structural: StructuralCombination[] = [];

  for (const input of combinationInputs) {
    // invalid_json combinations were excluded above (surfaced via
    // `skipped`) and never reach classification.
    if (input.failure != null) {
      continue;
    }
    // Safe: every input reaching this point has neither an aborting failure
    // (checked above) nor an invalid_json failure (skipped above), so
    // before/after are guaranteed populated.
    const before = input.before as Readonly<Record<string, unknown>>;
    const after = input.after as Readonly<Record<string, unknown>>;
    const result = classify({ before, after });

    if (result.kind === 'translation_only') {
      translationOnly.push({
        namespace: input.namespace,
        language: input.language,
        changedKeys: result.changedKeys,
        absoluteFilePath: input.absoluteFilePath,
        content: after,
      });
      continue;
    }
    if (result.kind === 'structural') {
      structural.push({
        namespace: input.namespace,
        language: input.language,
        addedKeys: result.addedKeys,
        removedKeys: result.removedKeys,
        filePath: input.absoluteFilePath,
        exportedContent: after,
      });
    }
    // 'no_change' combinations are intentionally excluded from both groups —
    // there is nothing to report for them.
  }

  return { ok: true, translationOnly, structural, skipped };
};

/**
 * The single branch every translation-only sync run converges onto.
 *
 * A fixed name (rather than one derived from the diff's content) is what
 * makes the "no duplicate PRs" property hold by construction: each run
 * rewrites this branch to the current POEditor state, so at most one
 * translation-only PR can ever be open. It is the same reasoning as
 * `sync_terms=1` on the push side — the operation converges to the current
 * state instead of accumulating one artifact per run.
 */
export const TRANSLATION_ONLY_BRANCH = 'i18n-sync/translation-only';

/** Injectable file-writing function, mirroring `ReadNamespaceFile`. */
export type WriteLocaleFile = (
  absolutePath: string,
  content: string,
) => Promise<void>;

const defaultWriteLocaleFile: WriteLocaleFile = (absolutePath, content) =>
  writeFile(absolutePath, content, 'utf-8');

/** Identifies one pull request on the repository. */
export interface PullRequestRef {
  readonly number: number;
}

/**
 * Everything the translation-only path needs to turn locally-written locale
 * files into an open pull request. Deliberately kept separate from
 * `ApprovalReviewer`: the two are performed by *different* GitHub identities
 * (GitHub refuses a self-approval), and the approving identity
 * (`I18N_SYNC_APPROVAL_TOKEN`) is scoped to `pull-requests: write` with no
 * content-write permission at all. Splitting the interfaces makes that
 * separation structural rather than a convention: an implementation of
 * `ApprovalReviewer` is handed no method that could write repository
 * content.
 */
export interface TranslationOnlyPrPublisher {
  /**
   * Commits the locale files at `filePaths` onto `headBranch` and pushes it.
   *
   * An implementation must stage **only** those paths — never the whole
   * working tree. A single pull run classifies both groups against the same
   * checkout, so the structural group's locale files can already be modified
   * alongside these; sweeping them in would put a structural change into the
   * translation-only pull request and merge it with no human review.
   */
  publishBranch(input: {
    readonly headBranch: string;
    readonly commitMessage: string;
    readonly filePaths: readonly string[];
  }): Promise<void>;
  /** The open, unmerged pull request for `headBranch`, or `null` if there is none. */
  findExistingPr(input: {
    readonly headBranch: string;
  }): Promise<PullRequestRef | null>;
  createPr(input: {
    readonly headBranch: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequestRef>;
  updatePr(input: {
    readonly pullRequest: PullRequestRef;
    readonly body: string;
  }): Promise<void>;
}

/** Submits the approving review, under an identity distinct from the PR's author. */
export interface ApprovalReviewer {
  submitApprovalReview(input: {
    readonly pullRequest: PullRequestRef;
  }): Promise<void>;
}

export type LintGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * The existing i18n CI gate (`pnpm run lint:i18n` /
 * `apps/app/tools/i18n-audit/`). This feature only *calls* the gate and
 * never touches its detection logic, so it enters here as an injected
 * collaborator rather than as a direct dependency on the audit tooling.
 */
export interface I18nLintGate {
  run(): Promise<LintGateResult>;
}

export interface ApplyTranslationOnlyChangesOptions {
  /** The `translationOnly` group produced by `collectClassifications`. */
  readonly combinations: readonly TranslationOnlyCombination[];
  readonly prPublisher: TranslationOnlyPrPublisher;
  readonly approvalReviewer: ApprovalReviewer;
  readonly lintGate: I18nLintGate;
  /** Injectable file writer. Defaults to writing the real filesystem. */
  readonly writeLocaleFile?: WriteLocaleFile;
}

export type ApplyTranslationOnlyChangesResult =
  | { readonly ok: true; readonly outcome: 'no_changes' }
  | {
      readonly ok: true;
      readonly outcome: 'approved';
      readonly pullRequest: PullRequestRef;
      /** `true` when this run opened the PR, `false` when it updated an already-open one. */
      readonly created: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: 'lint_gate_failed';
      /** The PR that carries the failing check, left open for maintainers to inspect. */
      readonly pullRequest: PullRequestRef;
      readonly message: string;
    };

/**
 * Serializes a locale file the way the repository's own locale files are
 * formatted: 2-space indent with a trailing newline.
 */
const serializeLocaleFile = (
  content: Readonly<Record<string, unknown>>,
): string => `${JSON.stringify(content, null, 2)}\n`;

const buildPrBody = (
  combinations: readonly TranslationOnlyCombination[],
): string => {
  const lines = combinations.map(
    (combination) =>
      `- \`${combination.namespace}\` / \`${combination.language}\`: ${combination.changedKeys.length} key(s) retranslated`,
  );
  return [
    'Translations pulled from POEditor. Every combination below changes only the',
    'values of existing keys — the leaf key set is identical before and after —',
    'so this pull request takes the automatic path and is approved by the sync',
    'bot once `lint:i18n` passes.',
    '',
    ...lines,
  ].join('\n');
};

const PR_TITLE = 'chore(i18n): apply translation-only updates from POEditor';

/**
 * Applies the `translation_only` group: writes each combination's exported
 * content to its locale file, gathers them into a *single* pull request, runs
 * the existing i18n CI gate, and — only if the gate passes — has the approval
 * bot submit an approving review.
 *
 * **Why approving is enough, and why it does not bypass CI.** The approving
 * review only satisfies the `#approved-reviews-by >= 1` condition of the
 * existing `.github/mergify.yml` rule "Automatic queue to merge", which
 * merely puts the PR into the merge queue. The queue's own `queue_rules`
 * independently require `check-success ~= ci-app-lint` (which contains
 * `lint:i18n`) before anything merges. So the gate is applied twice and is
 * never circumvented — this file adds no new merge route and changes no
 * Mergify rule.
 *
 * **Step order is load-bearing, not incidental.** The gate reads the locale
 * files from disk, so it must run *after* they are written, and a failing
 * gate needs an open pull request to attach its failing check to. Hence:
 * write → publish branch → create-or-update the PR → run the gate → approve.
 *
 * **Why writing whole files is safe.** `translation_only` means the two leaf
 * key sets are identical, so overwriting the file with the exported content
 * can only change values, never the key set — the property that makes this
 * change eligible for the no-human-review path in the first place.
 *
 * On a gate failure nothing is approved and the PR is deliberately left open
 * with its failing check; the failure is returned so the caller can fail the
 * workflow.
 */
export const applyTranslationOnlyChanges = async (
  options: ApplyTranslationOnlyChangesOptions,
): Promise<ApplyTranslationOnlyChangesResult> => {
  const { combinations, prPublisher, approvalReviewer, lintGate } = options;
  const writeLocaleFile = options.writeLocaleFile ?? defaultWriteLocaleFile;

  if (combinations.length === 0) {
    // Nothing to propose: opening an empty pull request (and paying for a
    // gate run on it) would be pure noise.
    return { ok: true, outcome: 'no_changes' };
  }

  const filePaths = combinations.map(
    (combination) => combination.absoluteFilePath,
  );

  await Promise.all(
    combinations.map((combination) =>
      writeLocaleFile(
        combination.absoluteFilePath,
        serializeLocaleFile(combination.content),
      ),
    ),
  );

  await prPublisher.publishBranch({
    headBranch: TRANSLATION_ONLY_BRANCH,
    commitMessage: PR_TITLE,
    // Only this group's files: see publishBranch's contract for why staging
    // anything else would carry the other group's changes into this PR.
    filePaths,
  });

  const body = buildPrBody(combinations);
  const existingPr = await prPublisher.findExistingPr({
    headBranch: TRANSLATION_ONLY_BRANCH,
  });

  let pullRequest: PullRequestRef;
  let created: boolean;
  if (existingPr != null) {
    await prPublisher.updatePr({ pullRequest: existingPr, body });
    pullRequest = existingPr;
    created = false;
  } else {
    pullRequest = await prPublisher.createPr({
      headBranch: TRANSLATION_ONLY_BRANCH,
      title: PR_TITLE,
      body,
    });
    created = true;
  }

  const gateResult = await lintGate.run();
  if (!gateResult.ok) {
    return {
      ok: false,
      reason: 'lint_gate_failed',
      pullRequest,
      message: gateResult.message,
    };
  }

  await approvalReviewer.submitApprovalReview({ pullRequest });

  return { ok: true, outcome: 'approved', pullRequest, created };
};

/**
 * The single branch every structural-review sync run converges onto,
 * mirroring `TRANSLATION_ONLY_BRANCH`'s "no duplicate PRs" reasoning.
 * Deliberately a different fixed branch than `TRANSLATION_ONLY_BRANCH` --
 * the two groups must never land on the same branch, or a structural change
 * would ride along in the no-human-review translation-only PR.
 */
export const STRUCTURAL_BRANCH = 'i18n-sync/structural-review';

/**
 * Everything the structural-review path needs to turn locally-written
 * locale files into a pull request awaiting **human** review.
 *
 * This is structurally identical in shape to `TranslationOnlyPrPublisher`
 * today, but declared as its own type on purpose: `applyStructuralChanges`
 * (below) has no `ApprovalReviewer` parameter at all, which is what makes
 * it type-impossible for this path to submit a bot approval. Collapsing
 * this to a shared alias with `TranslationOnlyPrPublisher` would still keep
 * that guarantee (the missing `ApprovalReviewer` parameter is the actual
 * barrier), but would blur the intent that these two publishers serve
 * deliberately different review policies -- a future change to one (e.g.
 * adding a structural-only field) should not silently apply to the other
 * just because they happened to share a type.
 */
export interface StructuralPrPublisher {
  /**
   * Commits the locale files at `filePaths` onto `headBranch` and pushes it.
   * Same "only these paths, never the whole working tree" contract as
   * `TranslationOnlyPrPublisher.publishBranch` -- staging the translation-only
   * group's files here would carry them into this PR instead.
   */
  publishBranch(input: {
    readonly headBranch: string;
    readonly commitMessage: string;
    readonly filePaths: readonly string[];
  }): Promise<void>;
  /** The open, unmerged pull request for `headBranch`, or `null` if there is none. */
  findExistingPr(input: {
    readonly headBranch: string;
  }): Promise<PullRequestRef | null>;
  createPr(input: {
    readonly headBranch: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequestRef>;
  updatePr(input: {
    readonly pullRequest: PullRequestRef;
    readonly body: string;
  }): Promise<void>;
}

export interface ApplyStructuralChangesOptions {
  /** The `structural` group produced by `collectClassifications`. */
  readonly combinations: readonly StructuralCombination[];
  readonly prPublisher: StructuralPrPublisher;
  /** Injectable file writer. Defaults to writing the real filesystem. */
  readonly writeLocaleFile?: WriteLocaleFile;
}

export type ApplyStructuralChangesResult =
  | { readonly ok: true; readonly outcome: 'no_changes' }
  | {
      readonly ok: true;
      readonly outcome: 'pr_ready';
      readonly pullRequest: PullRequestRef;
      /** `true` when this run opened the PR, `false` when it updated an already-open one. */
      readonly created: boolean;
    };

const buildStructuralPrBody = (
  combinations: readonly StructuralCombination[],
): string => {
  const lines = combinations.map((combination) => {
    const added = combination.addedKeys.length;
    const removed = combination.removedKeys.length;
    return `- \`${combination.namespace}\` / \`${combination.language}\`: +${added} key(s), -${removed} key(s)`;
  });
  return [
    'Translations pulled from POEditor. Every combination below adds or removes',
    'at least one key, so this pull request awaits human review before it can',
    'merge -- no approval is submitted automatically for structural changes.',
    '',
    ...lines,
  ].join('\n');
};

const STRUCTURAL_PR_TITLE =
  'chore(i18n): review structural updates from POEditor';

/**
 * Applies the `structural` group: writes each combination's exported
 * content to its locale file and gathers them into a *single* pull request
 * awaiting human review. Unlike `applyTranslationOnlyChanges`, this
 * function has no `ApprovalReviewer` parameter at all and never runs the
 * i18n lint gate itself -- both are deliberately absent rather than merely
 * unused, so no code path here can submit a bot approval even by mistake.
 * The existing `ci-app-lint` check still runs on this PR the same way it
 * runs on any other pull request; only the auto-approval step is skipped.
 *
 * Mirrors `applyTranslationOnlyChanges`'s idempotency: a fixed branch name
 * (`STRUCTURAL_BRANCH`) means a second run against the same diff updates
 * the already-open PR instead of opening a second one.
 */
export const applyStructuralChanges = async (
  options: ApplyStructuralChangesOptions,
): Promise<ApplyStructuralChangesResult> => {
  const { combinations, prPublisher } = options;
  const writeLocaleFile = options.writeLocaleFile ?? defaultWriteLocaleFile;

  if (combinations.length === 0) {
    // Nothing to propose -- same reasoning as applyTranslationOnlyChanges's
    // empty-group short circuit.
    return { ok: true, outcome: 'no_changes' };
  }

  const filePaths = combinations.map((combination) => combination.filePath);

  await Promise.all(
    combinations.map((combination) =>
      writeLocaleFile(
        combination.filePath,
        serializeLocaleFile(combination.exportedContent),
      ),
    ),
  );

  await prPublisher.publishBranch({
    headBranch: STRUCTURAL_BRANCH,
    commitMessage: STRUCTURAL_PR_TITLE,
    filePaths,
  });

  const body = buildStructuralPrBody(combinations);
  const existingPr = await prPublisher.findExistingPr({
    headBranch: STRUCTURAL_BRANCH,
  });

  let pullRequest: PullRequestRef;
  let created: boolean;
  if (existingPr != null) {
    await prPublisher.updatePr({ pullRequest: existingPr, body });
    pullRequest = existingPr;
    created = false;
  } else {
    pullRequest = await prPublisher.createPr({
      headBranch: STRUCTURAL_BRANCH,
      title: STRUCTURAL_PR_TITLE,
      body,
    });
    created = true;
  }

  return { ok: true, outcome: 'pr_ready', pullRequest, created };
};

/**
 * Everything one full pull run needs, and the pure orchestration function
 * that sequences `collectClassifications` / `applyTranslationOnlyChanges` /
 * `applyStructuralChanges` the way `main()` (below) is required to. Kept as
 * its own function -- separate from `main()` -- so the sequencing and
 * failure aggregation are unit-testable with injected fakes, without
 * touching `process.env` or a real process exit (mirrors `push-source.ts`'s
 * `runPush`/`main` split).
 *
 * **Step order is load-bearing**: `applyTranslationOnlyChanges` runs before
 * `applyStructuralChanges` on purpose. `applyTranslationOnlyChanges`'s
 * `I18nLintGate` reads the working tree from disk, so if the structural
 * group's files were written first, the gate could see structural
 * (key-adding/removing) content and fail for the wrong reason. Running
 * translation-only first, gate included, keeps that check's view of the
 * tree limited to what it is actually judging.
 *
 * Both apply steps run even if one fails -- they write to different
 * branches and open different pull requests, so a translation-only gate
 * failure has no bearing on whether the structural review PR should still
 * be opened (and vice versa). Every failure encountered is aggregated into
 * `failures` rather than the run stopping at the first one, so a single
 * `main()` invocation surfaces everything that went wrong in one report.
 */
export interface RunPullOptions {
  readonly poeditorClient: PoeditorClient;
  /** Forwarded to `collectClassifications`. Defaults to the real `SYNC_TARGETS`. */
  readonly targets?: readonly NamespaceSyncEntry[];
  /** Forwarded to `collectClassifications`. Defaults to the real `NON_SOURCE_LANGUAGES`. */
  readonly languages?: readonly string[];
  /** Forwarded to `collectClassifications`. Defaults to reading the real filesystem. */
  readonly readNamespaceFile?: ReadNamespaceFile;
  /** Forwarded to `collectClassifications`. Defaults to this file's own package root. */
  readonly baseDir?: string;
  /** Forwarded to both apply steps. Defaults to writing the real filesystem. */
  readonly writeLocaleFile?: WriteLocaleFile;
  readonly translationOnlyPrPublisher: TranslationOnlyPrPublisher;
  readonly approvalReviewer: ApprovalReviewer;
  readonly lintGate: I18nLintGate;
  readonly structuralPrPublisher: StructuralPrPublisher;
  /**
   * Injectable overrides for the three sequenced functions themselves, so
   * tests can exercise `runPull`'s sequencing/failure-aggregation logic
   * without depending on `collectClassifications`/`applyTranslationOnlyChanges`/
   * `applyStructuralChanges`'s own real behavior. Each defaults to the real
   * exported function.
   */
  readonly collectClassificationsFn?: typeof collectClassifications;
  readonly applyTranslationOnlyChangesFn?: typeof applyTranslationOnlyChanges;
  readonly applyStructuralChangesFn?: typeof applyStructuralChanges;
}

export type RunPullResult =
  | {
      readonly ok: true;
      /**
       * (namespace, language) combinations `collectClassifications` excluded
       * because their POEditor export was not valid JSON. The run still
       * succeeds -- this is threaded through so `main()` can warn about them
       * instead of the run completing silently with no trace of the skipped
       * combination.
       */
      readonly skipped: readonly InvalidJsonFailure[];
    }
  | { readonly ok: false; readonly failures: readonly string[] };

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runPull = async (
  options: RunPullOptions,
): Promise<RunPullResult> => {
  const collect = options.collectClassificationsFn ?? collectClassifications;
  const applyTranslationOnly =
    options.applyTranslationOnlyChangesFn ?? applyTranslationOnlyChanges;
  const applyStructural =
    options.applyStructuralChangesFn ?? applyStructuralChanges;

  const classification = await collect({
    poeditorClient: options.poeditorClient,
    targets: options.targets,
    languages: options.languages,
    readNamespaceFile: options.readNamespaceFile,
    baseDir: options.baseDir,
  });

  if (!classification.ok) {
    return {
      ok: false,
      failures: classification.failures.map(
        (failure) =>
          `collectClassifications: ${failure.namespace}/${failure.language} (${failure.reason})`,
      ),
    };
  }

  const failures: string[] = [];

  try {
    const translationOnlyResult = await applyTranslationOnly({
      combinations: classification.translationOnly,
      prPublisher: options.translationOnlyPrPublisher,
      approvalReviewer: options.approvalReviewer,
      lintGate: options.lintGate,
      writeLocaleFile: options.writeLocaleFile,
    });
    if (!translationOnlyResult.ok) {
      failures.push(
        `applyTranslationOnlyChanges: ${translationOnlyResult.reason} - ${translationOnlyResult.message}`,
      );
    }
  } catch (error) {
    failures.push(`applyTranslationOnlyChanges: ${describeError(error)}`);
  }

  try {
    const structuralResult = await applyStructural({
      combinations: classification.structural,
      prPublisher: options.structuralPrPublisher,
      writeLocaleFile: options.writeLocaleFile,
    });
    if (!structuralResult.ok) {
      // applyStructuralChanges has no failing outcome today, but this is
      // checked defensively in case its result type gains one later.
      failures.push('applyStructuralChanges: failed');
    }
  } catch (error) {
    failures.push(`applyStructuralChanges: ${describeError(error)}`);
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true, skipped: classification.skipped };
};

type GitHubCollaborators = Pick<
  RunPullOptions,
  | 'translationOnlyPrPublisher'
  | 'approvalReviewer'
  | 'lintGate'
  | 'structuralPrPublisher'
>;

interface GitHubRunConfig {
  readonly repository: string;
  /** Identity that authors and pushes the sync pull requests. */
  readonly publishToken: string;
  /** Identity that submits the approving review. Never the publishing one. */
  readonly approvalToken: string;
  readonly apiBaseUrl: string;
}

/**
 * Reads and validates the GitHub-side configuration before anything runs.
 *
 * Validating up front (rather than letting a missing value surface when the
 * first pull request is published) matters because the failure it guards
 * against is a *configuration* mistake in the workflow, and a run that gets
 * as far as force-pushing a branch and only then discovers it has no
 * approval identity leaves an unapproved pull request behind.
 *
 * The equality check is the runtime backstop for the identity separation:
 * `ApprovalReviewer` being its own interface makes it impossible for the
 * approving adapter to write content, but nothing at the type level stops
 * an operator from putting the *same secret* into both workflow inputs.
 * GitHub refuses a self-approval, so such a run could never satisfy
 * `.github/mergify.yml`'s `#approved-reviews-by >= 1` anyway — it would
 * just fail late and confusingly instead of early and clearly.
 */
const readGitHubRunConfig = (
  env: NodeJS.ProcessEnv,
): { ok: true; config: GitHubRunConfig } | { ok: false; message: string } => {
  const repository = env.GITHUB_REPOSITORY;
  if (repository == null || repository === '') {
    return {
      ok: false,
      message:
        'Cannot pull translations: GITHUB_REPOSITORY (owner/repo) is not set in the environment.',
    };
  }

  // A dedicated publishing identity is preferred over the workflow's own
  // GITHUB_TOKEN: events created by GITHUB_TOKEN do not start further
  // workflow runs, so a pull request opened with it would never get the
  // `ci-app-lint` check that `.github/mergify.yml`'s queue conditions
  // require, and would sit in the queue forever. The fallback is kept so a
  // dry run in a fork still works, where nothing needs to merge.
  // `||`, not `??`: GitHub Actions exports an unregistered secret as an
  // empty string, not as unset, so `??` (which only falls back on
  // null/undefined) would keep the empty value and never reach GITHUB_TOKEN.
  const dedicatedPublishToken = env.I18N_SYNC_PUBLISH_TOKEN;
  const publishToken =
    dedicatedPublishToken && dedicatedPublishToken !== ''
      ? dedicatedPublishToken
      : env.GITHUB_TOKEN;
  if (publishToken == null || publishToken === '') {
    return {
      ok: false,
      message:
        'Cannot pull translations: neither I18N_SYNC_PUBLISH_TOKEN nor GITHUB_TOKEN is set in the environment.',
    };
  }
  if (dedicatedPublishToken == null || dedicatedPublishToken === '') {
    // Not a fatal misconfiguration (a fork dry run has no reason to hold a
    // dedicated publish token), but a run that reaches production this way
    // will open a PR that never gets `ci-app-lint` and sits in the merge
    // queue forever -- see the comment above. Warn loudly rather than let
    // that failure stay silent until someone notices a stuck PR.
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.error(
      'Warning: I18N_SYNC_PUBLISH_TOKEN is not set; falling back to GITHUB_TOKEN. ' +
        'A pull request authored by GITHUB_TOKEN will not trigger ci-app-lint and will ' +
        'never satisfy the Mergify queue condition -- register I18N_SYNC_PUBLISH_TOKEN ' +
        'per docs/i18n-community-translation-setup.md before relying on this in production.',
    );
  }

  const approvalToken = env.I18N_SYNC_APPROVAL_TOKEN;
  if (approvalToken == null || approvalToken === '') {
    return {
      ok: false,
      message:
        'Cannot pull translations: I18N_SYNC_APPROVAL_TOKEN (the approval bot identity) is not set in the environment.',
    };
  }

  if (approvalToken === publishToken) {
    return {
      ok: false,
      message:
        'Cannot pull translations: the approval bot must be a different identity from the one that publishes the pull request, but I18N_SYNC_APPROVAL_TOKEN and the publishing token hold the same value.',
    };
  }

  return {
    ok: true,
    config: {
      repository,
      publishToken,
      approvalToken,
      apiBaseUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    },
  };
};

/**
 * `main()`'s real collaborators. The two publishers share one base-ref
 * resolver on purpose — see `createBaseRefResolver`'s doc comment: both
 * sync branches must be cut from the checkout's original commit, or the
 * structural pull request would inherit the translation-only commit made
 * moments earlier.
 *
 * The approving identity is constructed from `approvalToken` alone and is
 * never handed `publishToken`; conversely the publishers are never handed
 * `approvalToken`.
 */
const createGitHubCollaborators = (
  config: GitHubRunConfig,
): GitHubCollaborators => {
  const resolveBaseRef = createBaseRefResolver();
  const publisherOptions = {
    publishToken: config.publishToken,
    repository: config.repository,
    apiBaseUrl: config.apiBaseUrl,
    resolveBaseRef,
  };

  return {
    translationOnlyPrPublisher:
      createTranslationOnlyPrPublisher(publisherOptions),
    structuralPrPublisher: createStructuralPrPublisher(publisherOptions),
    approvalReviewer: createApprovalReviewer({
      approvalToken: config.approvalToken,
      repository: config.repository,
      apiBaseUrl: config.apiBaseUrl,
    }),
    lintGate: createI18nLintGate(),
  };
};

/**
 * Process-entrypoint wrapper, mirroring `push-source.ts`'s `main()`: reads
 * the POEditor API token from `process.env`, runs `runPull`, prints the
 * outcome, and sets a non-zero exit code on failure.
 *
 * Accepts an optional `overrides` argument -- unlike `push-source.ts`'s
 * `main()`, which takes none -- specifically so tests can exercise this
 * function's own failure-aggregation/exit-code behavior with
 * injected/mocked sub-functions, without needing a real
 * `POEDITOR_API_TOKEN` or GitHub credentials. A real invocation (`main()`,
 * no arguments) uses the real `PoeditorClient` and the real GitHub adapters
 * built by `createGitHubCollaborators`.
 */
export const main = async (
  overrides: Partial<
    Pick<
      RunPullOptions,
      | 'translationOnlyPrPublisher'
      | 'approvalReviewer'
      | 'lintGate'
      | 'structuralPrPublisher'
      | 'collectClassificationsFn'
      | 'applyTranslationOnlyChangesFn'
      | 'applyStructuralChangesFn'
      | 'writeLocaleFile'
    >
  > = {},
): Promise<void> => {
  const apiToken = process.env.POEDITOR_API_TOKEN;
  if (apiToken == null || apiToken === '') {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.error(
      'Cannot pull from POEditor: POEDITOR_API_TOKEN is not set in the environment.',
    );
    process.exitCode = 1;
    return;
  }

  const gitHubConfig = readGitHubRunConfig(process.env);
  if (!gitHubConfig.ok) {
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.error(gitHubConfig.message);
    process.exitCode = 1;
    return;
  }

  const poeditorClient = createPoeditorClient({ apiToken });
  const defaults = createGitHubCollaborators(gitHubConfig.config);

  const result = await runPull({
    poeditorClient,
    translationOnlyPrPublisher:
      overrides.translationOnlyPrPublisher ??
      defaults.translationOnlyPrPublisher,
    approvalReviewer: overrides.approvalReviewer ?? defaults.approvalReviewer,
    lintGate: overrides.lintGate ?? defaults.lintGate,
    structuralPrPublisher:
      overrides.structuralPrPublisher ?? defaults.structuralPrPublisher,
    collectClassificationsFn: overrides.collectClassificationsFn,
    applyTranslationOnlyChangesFn: overrides.applyTranslationOnlyChangesFn,
    applyStructuralChangesFn: overrides.applyStructuralChangesFn,
    writeLocaleFile: overrides.writeLocaleFile,
  });

  if (result.ok) {
    if (result.skipped.length > 0) {
      // A skipped combination must never disappear silently. The run still
      // succeeds -- the other combinations keep going -- so this is a
      // warning, not a failing exit code; this GitHub Actions run log is the
      // maintainer-visible channel for it.
      // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
      console.error(
        `Warning: skipped ${result.skipped.length} combination(s) with malformed POEditor export data:\n${result.skipped
          .map(
            (failure) =>
              `  - ${failure.namespace}/${failure.language}: ${failure.message}`,
          )
          .join('\n')}`,
      );
    }
    // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
    console.log('Pull sync completed: no failures.');
    return;
  }

  // biome-ignore lint/suspicious/noConsole: this is a CI script, console output is expected.
  console.error(
    `Failed:\n${result.failures.map((failure) => `  - ${failure}`).join('\n')}`,
  );
  process.exitCode = 1;
};

// Only run when executed directly (`node tools/i18n-sync/pull-translations.ts`),
// not when imported by tests -- otherwise importing this module would attempt
// to read `process.env.POEDITOR_API_TOKEN` and run the real entrypoint as a
// side effect of the import itself (mirrors push-source.ts's same guard).
if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
