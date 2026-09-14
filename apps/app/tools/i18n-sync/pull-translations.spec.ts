import { mock } from 'vitest-mock-extended';

import type { PoeditorClient } from './poeditor-client.ts';
import {
  type ApprovalReviewer,
  applyStructuralChanges,
  applyTranslationOnlyChanges,
  collectClassifications,
  type I18nLintGate,
  main,
  type PullRequestRef,
  runPull,
  STRUCTURAL_BRANCH,
  type StructuralCombination,
  type StructuralPrPublisher,
  TRANSLATION_ONLY_BRANCH,
  type TranslationOnlyCombination,
  type TranslationOnlyPrPublisher,
  type WriteLocaleFile,
} from './pull-translations.ts';
import type { NamespaceSyncEntry } from './sync-config.ts';

// A small 3-entry fixture mirroring the shape of the real SYNC_TARGETS
// (admin/translation/commons), injected via `targets` so this test never
// depends on the real POEditor project IDs declared in sync-config.ts.
const TEST_TARGETS: readonly NamespaceSyncEntry[] = [
  {
    namespace: 'admin',
    poeditorProjectId: 'project-admin',
    localeFilePath: (lang) => `locales/${lang}/admin.json`,
  },
  {
    namespace: 'translation',
    poeditorProjectId: 'project-translation',
    localeFilePath: (lang) => `locales/${lang}/translation.json`,
  },
  {
    namespace: 'commons',
    poeditorProjectId: 'project-commons',
    localeFilePath: (lang) => `locales/${lang}/commons.json`,
  },
];

const TEST_LANGUAGES = ['ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'] as const;

// "before" (currently committed) content per namespace, keyed by
// `/base/locales/<lang>/<namespace>.json` -- identical across all 4
// languages for a given namespace, mirroring how a real locale file only
// differs from language to language in its values, not its base shape.
const BEFORE_BY_NAMESPACE: Readonly<Record<string, string>> = {
  admin: '{"k1":"v1","k2":"v2"}',
  translation: '{"t1":"a","t2":"b"}',
  commons: '{"c1":"a","c2":"b"}',
};

// "after" (POEditor export) content per namespace+language, deliberately
// mixing all 3 classification kinds across the 12 combinations:
//   translation_only: admin/ja_JP, admin/ko_KR, translation/zh_CN,
//                      commons/zh_CN, commons/ko_KR
//   structural:        admin/zh_CN, translation/ja_JP, translation/fr_FR,
//                      commons/fr_FR
//   no_change:         admin/fr_FR, translation/ko_KR, commons/ja_JP
const AFTER_BY_NAMESPACE_LANGUAGE: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  admin: {
    ja_JP: '{"k1":"CHANGED","k2":"v2"}', // translation_only
    zh_CN: '{"k1":"v1","k3":"v3"}', // structural (removed k2, added k3)
    fr_FR: '{"k1":"v1","k2":"v2"}', // no_change
    ko_KR: '{"k1":"v1","k2":"CHANGED"}', // translation_only
  },
  translation: {
    ja_JP: '{"t1":"a","t2":"b","t3":"c"}', // structural (added t3)
    zh_CN: '{"t1":"CHANGED","t2":"b"}', // translation_only
    fr_FR: '{"t2":"b"}', // structural (removed t1)
    ko_KR: '{"t1":"a","t2":"b"}', // no_change
  },
  commons: {
    ja_JP: '{"c1":"a","c2":"b"}', // no_change
    zh_CN: '{"c1":"CHANGED","c2":"b"}', // translation_only
    fr_FR: '{"c1":"a"}', // structural (removed c2)
    ko_KR: '{"c1":"a","c2":"CHANGED"}', // translation_only
  },
};

const PROJECT_ID_TO_NAMESPACE: Readonly<Record<string, string>> = {
  'project-admin': 'admin',
  'project-translation': 'translation',
  'project-commons': 'commons',
};

/** Builds a poeditorClient double whose exportTranslations resolves per (projectId, language) from AFTER_BY_NAMESPACE_LANGUAGE. */
const buildPoeditorClient = (): PoeditorClient => {
  const poeditorClient = mock<PoeditorClient>();
  poeditorClient.exportTranslations.mockImplementation(
    // biome-ignore lint/suspicious/useAwait: must match PoeditorClient's Promise-returning signature.
    async ({ projectId, language }) => {
      const namespace = PROJECT_ID_TO_NAMESPACE[projectId];
      const content = AFTER_BY_NAMESPACE_LANGUAGE[namespace]?.[language];
      if (content == null) {
        throw new Error(`no fixture for ${projectId}/${language}`);
      }
      return { ok: true, value: content };
    },
  );
  return poeditorClient;
};

const buildReadNamespaceFile = () =>
  // biome-ignore lint/suspicious/useAwait: must match ReadNamespaceFile's Promise-returning signature.
  vi.fn(async (absolutePath: string) => {
    const match = /\/base\/locales\/[^/]+\/(\w+)\.json$/.exec(absolutePath);
    const namespace = match?.[1];
    const content =
      namespace != null ? BEFORE_BY_NAMESPACE[namespace] : undefined;
    if (content == null) {
      throw new Error(`no fixture for ${absolutePath}`);
    }
    return content;
  });

describe('collectClassifications', () => {
  it('reads and exports all 3 namespace x 4 language combinations (12 total) and classifies each', async () => {
    const poeditorClient = buildPoeditorClient();
    const readNamespaceFile = buildReadNamespaceFile();

    const result = await collectClassifications({
      poeditorClient,
      targets: TEST_TARGETS,
      languages: TEST_LANGUAGES,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result.ok).toBe(true);
    expect(poeditorClient.exportTranslations).toHaveBeenCalledTimes(12);
    expect(readNamespaceFile).toHaveBeenCalledTimes(12);
  });

  it('separates translation_only and structural combinations into two disjoint groups with no mixing, from a 12-combination input mixing all 3 classification kinds', async () => {
    // A real pull run mixes no_change, translation_only, and structural
    // results across the 12 combinations, and the two output groups must
    // never let a structural result leak into the translationOnly group (or
    // vice versa) -- doing so would let a structural, key-adding-or-removing
    // change auto-merge via the translation_only PR's no-human-review path.
    const poeditorClient = buildPoeditorClient();
    const readNamespaceFile = buildReadNamespaceFile();

    const result = await collectClassifications({
      poeditorClient,
      targets: TEST_TARGETS,
      languages: TEST_LANGUAGES,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Exact membership of each group, keyed by namespace/language only (not
    // asserting on changedKeys/addedKeys/removedKeys here -- covered below).
    const translationOnlyKeys = result.translationOnly
      .map((c) => `${c.namespace}/${c.language}`)
      .sort();
    const structuralKeys = result.structural
      .map((c) => `${c.namespace}/${c.language}`)
      .sort();

    expect(translationOnlyKeys).toEqual(
      [
        'admin/ja_JP',
        'admin/ko_KR',
        'commons/ko_KR',
        'commons/zh_CN',
        'translation/zh_CN',
      ].sort(),
    );
    expect(structuralKeys).toEqual(
      [
        'admin/zh_CN',
        'commons/fr_FR',
        'translation/fr_FR',
        'translation/ja_JP',
      ].sort(),
    );

    // no_change combinations (admin/fr_FR, translation/ko_KR, commons/ja_JP)
    // must appear in neither group.
    const allReported = [...translationOnlyKeys, ...structuralKeys];
    expect(allReported).not.toContain('admin/fr_FR');
    expect(allReported).not.toContain('translation/ko_KR');
    expect(allReported).not.toContain('commons/ja_JP');
    expect(allReported).toHaveLength(9);

    // The airtight form of the invariant: every single element actually
    // classified as `structural` by DiffClassifier must be absent from the
    // translationOnly group's list, checked one-by-one rather than just by
    // group size/non-emptiness. If the grouping logic were buggy -- e.g. it
    // accidentally pushed every result into one array, or mislabeled a
    // structural result as translation_only -- this loop is what would
    // catch it (a bare "both groups are non-empty" assertion would not).
    for (const key of structuralKeys) {
      expect(translationOnlyKeys).not.toContain(key);
    }
    for (const key of translationOnlyKeys) {
      expect(structuralKeys).not.toContain(key);
    }

    // Spot-check the classification payload itself is the real,
    // kind-appropriate shape (not a stub), confirming the grouping
    // consumed DiffClassifier's actual result rather than a hand-built one.
    const adminZhCn = result.structural.find(
      (c) => c.namespace === 'admin' && c.language === 'zh_CN',
    );
    expect(adminZhCn).toEqual({
      namespace: 'admin',
      language: 'zh_CN',
      addedKeys: ['k3'],
      removedKeys: ['k2'],
      // Same reasoning as translationOnly's absoluteFilePath/content above,
      // under different field names (see StructuralCombination's doc
      // comment).
      filePath: '/base/locales/zh_CN/admin.json',
      exportedContent: { k1: 'v1', k3: 'v3' },
    });

    const adminJaJp = result.translationOnly.find(
      (c) => c.namespace === 'admin' && c.language === 'ja_JP',
    );
    expect(adminJaJp).toEqual({
      namespace: 'admin',
      language: 'ja_JP',
      changedKeys: ['k1'],
      // The exported content that was classified, plus the exact file it was
      // classified against, travel with the combination so the apply step
      // (`applyTranslationOnlyChanges`) writes precisely what
      // `DiffClassifier` approved -- see that function's doc comment.
      absoluteFilePath: '/base/locales/ja_JP/admin.json',
      content: { k1: 'CHANGED', k2: 'v2' },
    });
  });

  it('excludes no_change combinations from both groups without treating them as an error', async () => {
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.exportTranslations.mockResolvedValue({
      ok: true,
      value: '{"only_key":"same"}',
    });
    const readNamespaceFile = vi.fn(async () => '{"only_key":"same"}');

    const result = await collectClassifications({
      poeditorClient,
      targets: TEST_TARGETS,
      languages: TEST_LANGUAGES,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.translationOnly).toEqual([]);
      expect(result.structural).toEqual([]);
    }
  });

  it('aborts the whole run (reports failure, no grouping) when one combination fails to read', async () => {
    const poeditorClient = buildPoeditorClient();
    // biome-ignore lint/suspicious/useAwait: must match ReadNamespaceFile's Promise-returning signature.
    const readNamespaceFile = vi.fn(async (absolutePath: string) => {
      if (absolutePath === '/base/locales/ja_JP/admin.json') {
        throw new Error('ENOENT: no such file or directory');
      }
      const match = /\/base\/locales\/[^/]+\/(\w+)\.json$/.exec(absolutePath);
      const namespace = match?.[1] as string;
      return BEFORE_BY_NAMESPACE[namespace];
    });

    const result = await collectClassifications({
      poeditorClient,
      targets: TEST_TARGETS,
      languages: TEST_LANGUAGES,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toEqual([
        {
          namespace: 'admin',
          language: 'ja_JP',
          reason: 'read_failed',
          message: 'ENOENT: no such file or directory',
        },
      ]);
    }
  });

  it('aborts the whole run (reports failure, no grouping) when one combination fails to export from POEditor', async () => {
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.exportTranslations.mockImplementation(
      // biome-ignore lint/suspicious/useAwait: must match PoeditorClient's Promise-returning signature.
      async ({ projectId, language }) => {
        if (projectId === 'project-translation' && language === 'zh_CN') {
          return { ok: false, error: { type: 'rate_limited' } };
        }
        const namespace = PROJECT_ID_TO_NAMESPACE[projectId];
        const content = AFTER_BY_NAMESPACE_LANGUAGE[namespace]?.[language];
        return { ok: true, value: content ?? '{}' };
      },
    );
    const readNamespaceFile = buildReadNamespaceFile();

    const result = await collectClassifications({
      poeditorClient,
      targets: TEST_TARGETS,
      languages: TEST_LANGUAGES,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toEqual([
        {
          namespace: 'translation',
          language: 'zh_CN',
          reason: 'export_failed',
          error: { type: 'rate_limited' },
        },
      ]);
    }
  });

  it('does not abort the run when one combination has invalid-JSON export content -- only that combination is skipped, the rest classify normally', async () => {
    // Unlike read_failed/export_failed, invalid_json only excludes its own
    // (namespace, language) combination -- export is read-only, so a single
    // malformed combination is tolerated rather than aborting the whole run.
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.exportTranslations.mockImplementation(
      // biome-ignore lint/suspicious/useAwait: must match PoeditorClient's Promise-returning signature.
      async ({ projectId, language }) => {
        if (projectId === 'project-translation' && language === 'zh_CN') {
          // Malformed JSON -- triggers invalid_json, not export_failed
          // (PoeditorClient itself reports `ok: true`; the content is what's
          // broken).
          return { ok: true, value: '{not valid json' };
        }
        const namespace = PROJECT_ID_TO_NAMESPACE[projectId];
        const content = AFTER_BY_NAMESPACE_LANGUAGE[namespace]?.[language];
        return { ok: true, value: content ?? '{}' };
      },
    );
    const readNamespaceFile = buildReadNamespaceFile();

    const result = await collectClassifications({
      poeditorClient,
      targets: TEST_TARGETS,
      languages: TEST_LANGUAGES,
      readNamespaceFile,
      baseDir: '/base',
    });

    // (a) the run does not abort as a whole.
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // (b) the other 11 combinations are still classified normally. Per the
    // fixture (see AFTER_BY_NAMESPACE_LANGUAGE), translation/zh_CN was
    // translation_only before being replaced with invalid JSON here, so the
    // expected translationOnly group loses exactly that one entry versus
    // the "separates ... into two disjoint groups" test above.
    const translationOnlyKeys = result.translationOnly
      .map((c) => `${c.namespace}/${c.language}`)
      .sort();
    const structuralKeys = result.structural
      .map((c) => `${c.namespace}/${c.language}`)
      .sort();

    expect(translationOnlyKeys).toEqual(
      ['admin/ja_JP', 'admin/ko_KR', 'commons/ko_KR', 'commons/zh_CN'].sort(),
    );
    expect(structuralKeys).toEqual(
      [
        'admin/zh_CN',
        'commons/fr_FR',
        'translation/fr_FR',
        'translation/ja_JP',
      ].sort(),
    );

    // (c) the invalid_json combination is surfaced via `skipped`, and is
    // absent from both classification groups.
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      namespace: 'translation',
      language: 'zh_CN',
      reason: 'invalid_json',
    });
    expect(translationOnlyKeys).not.toContain('translation/zh_CN');
    expect(structuralKeys).not.toContain('translation/zh_CN');
  });
});

const buildCombination = (
  overrides: Partial<TranslationOnlyCombination> = {},
): TranslationOnlyCombination => ({
  namespace: 'admin',
  language: 'ja_JP',
  absoluteFilePath: '/base/locales/ja_JP/admin.json',
  changedKeys: ['k1'],
  content: { k1: 'CHANGED', k2: 'v2' },
  ...overrides,
});

interface ApplyHarness {
  /**
   * Every collaborator call, in the order it was made. Call *order* is what
   * these tests assert on rather than call counts alone: the gate reads the
   * locale files from disk, so a run that approved before writing them (or
   * before opening the PR that carries the check) would still satisfy every
   * "approval called once" count while validating stale content.
   */
  readonly calls: string[];
  readonly writeLocaleFile: WriteLocaleFile;
  readonly prPublisher: TranslationOnlyPrPublisher;
  readonly approvalReviewer: ApprovalReviewer;
  readonly lintGate: I18nLintGate;
}

const EXISTING_PR_NUMBER = 4242;

const buildApplyHarness = (options: {
  readonly lintGatePasses: boolean;
}): ApplyHarness => {
  const calls: string[] = [];

  const writeLocaleFile = vi.fn((absolutePath: string, _content: string) => {
    calls.push(`write:${absolutePath}`);
    return Promise.resolve();
  });

  // Stateful on purpose: the fake starts with no open translation-only PR and
  // remembers the one `createPr` opens, so running the same flow twice
  // against this harness reproduces the real second-run situation (an
  // unmerged PR is already open) rather than testing the two branches in
  // isolation.
  let openPullRequest: PullRequestRef | null = null;

  const prPublisher = mock<TranslationOnlyPrPublisher>();
  prPublisher.publishBranch.mockImplementation(() => {
    calls.push('publishBranch');
    return Promise.resolve();
  });
  prPublisher.findExistingPr.mockImplementation(() => {
    calls.push('findExistingPr');
    return Promise.resolve(openPullRequest);
  });
  prPublisher.createPr.mockImplementation(() => {
    calls.push('createPr');
    openPullRequest = { number: EXISTING_PR_NUMBER };
    return Promise.resolve(openPullRequest);
  });
  prPublisher.updatePr.mockImplementation(() => {
    calls.push('updatePr');
    return Promise.resolve();
  });

  const approvalReviewer = mock<ApprovalReviewer>();
  approvalReviewer.submitApprovalReview.mockImplementation(() => {
    calls.push('submitApprovalReview');
    return Promise.resolve();
  });

  const lintGate = mock<I18nLintGate>();
  lintGate.run.mockImplementation(() => {
    calls.push('lintGate');
    return Promise.resolve(
      options.lintGatePasses
        ? { ok: true as const }
        : {
            ok: false as const,
            message: 'lint:i18n failed: 3 missing keys in ko_KR/commons.json',
          },
    );
  });

  return { calls, writeLocaleFile, prPublisher, approvalReviewer, lintGate };
};

describe('applyTranslationOnlyChanges', () => {
  it('does nothing at all when the translation-only group is empty', async () => {
    const harness = buildApplyHarness({ lintGatePasses: true });

    const result = await applyTranslationOnlyChanges({
      combinations: [],
      writeLocaleFile: harness.writeLocaleFile,
      prPublisher: harness.prPublisher,
      approvalReviewer: harness.approvalReviewer,
      lintGate: harness.lintGate,
    });

    expect(result).toEqual({ ok: true, outcome: 'no_changes' });
    // No empty auto-merge PR, and no gate run to pay for on an empty diff.
    expect(harness.calls).toEqual([]);
  });

  it('writes the classified content, opens the PR, runs the gate, and only then submits exactly one approving review', async () => {
    const harness = buildApplyHarness({ lintGatePasses: true });
    const combinations = [
      buildCombination(),
      buildCombination({
        namespace: 'commons',
        language: 'ko_KR',
        absoluteFilePath: '/base/locales/ko_KR/commons.json',
        changedKeys: ['c2'],
        content: { c1: 'a', c2: 'CHANGED' },
      }),
    ];

    const result = await applyTranslationOnlyChanges({
      combinations,
      writeLocaleFile: harness.writeLocaleFile,
      prPublisher: harness.prPublisher,
      approvalReviewer: harness.approvalReviewer,
      lintGate: harness.lintGate,
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'approved',
      pullRequest: { number: EXISTING_PR_NUMBER },
      created: true,
    });

    // The whole point of the auto-merge path: the approving review is what
    // satisfies mergify's `#approved-reviews-by >= 1`, so it must come after
    // a passing gate run, which in turn must see the written files.
    expect(harness.calls).toEqual([
      'write:/base/locales/ja_JP/admin.json',
      'write:/base/locales/ko_KR/commons.json',
      'publishBranch',
      'findExistingPr',
      'createPr',
      'lintGate',
      'submitApprovalReview',
    ]);
    expect(harness.approvalReviewer.submitApprovalReview).toHaveBeenCalledTimes(
      1,
    );

    // Each combination's own exported content is written to the exact file it
    // was classified against, serialized the way the repository's locale
    // files are formatted (2-space indent, trailing newline).
    expect(harness.writeLocaleFile).toHaveBeenCalledWith(
      '/base/locales/ja_JP/admin.json',
      `${JSON.stringify({ k1: 'CHANGED', k2: 'v2' }, null, 2)}\n`,
    );
    expect(harness.writeLocaleFile).toHaveBeenCalledWith(
      '/base/locales/ko_KR/commons.json',
      `${JSON.stringify({ c1: 'a', c2: 'CHANGED' }, null, 2)}\n`,
    );

    // The approval goes to the PR that was just opened for this branch.
    expect(harness.approvalReviewer.submitApprovalReview).toHaveBeenCalledWith({
      pullRequest: { number: EXISTING_PR_NUMBER },
    });
    expect(harness.prPublisher.createPr).toHaveBeenCalledWith(
      expect.objectContaining({ headBranch: TRANSLATION_ONLY_BRANCH }),
    );

    // The branch carries exactly this group's files and nothing else. The
    // structural group is classified against the same checkout, so a
    // publisher told to stage the whole working tree would sweep a structural
    // change into this no-human-review pull request.
    expect(harness.prPublisher.publishBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        headBranch: TRANSLATION_ONLY_BRANCH,
        filePaths: [
          '/base/locales/ja_JP/admin.json',
          '/base/locales/ko_KR/commons.json',
        ],
      }),
    );
  });

  it('submits no approving review at all and surfaces the failure when the i18n lint gate fails', async () => {
    // A failing i18n CI gate must stop the change from reaching the default
    // branch. Since the only thing moving this PR into the merge queue is
    // the bot's approving review, "not approving" is exactly what blocks it
    // -- so this test fails loudly if the approval collaborator is touched
    // even once on the failing path.
    const harness = buildApplyHarness({ lintGatePasses: false });

    const result = await applyTranslationOnlyChanges({
      combinations: [buildCombination()],
      writeLocaleFile: harness.writeLocaleFile,
      prPublisher: harness.prPublisher,
      approvalReviewer: harness.approvalReviewer,
      lintGate: harness.lintGate,
    });

    expect(harness.approvalReviewer.submitApprovalReview).toHaveBeenCalledTimes(
      0,
    );
    expect(harness.calls).not.toContain('submitApprovalReview');

    expect(result).toEqual({
      ok: false,
      reason: 'lint_gate_failed',
      pullRequest: { number: EXISTING_PR_NUMBER },
      message: 'lint:i18n failed: 3 missing keys in ko_KR/commons.json',
    });

    // The PR is deliberately left open with its failing check on it, so the
    // maintainer can see what failed.
    expect(harness.prPublisher.createPr).toHaveBeenCalledTimes(1);
  });

  it('updates the already-open PR instead of opening a second one when run twice on the same diff', async () => {
    const harness = buildApplyHarness({ lintGatePasses: true });
    const combinations = [buildCombination()];
    const runOnce = () =>
      applyTranslationOnlyChanges({
        combinations,
        writeLocaleFile: harness.writeLocaleFile,
        prPublisher: harness.prPublisher,
        approvalReviewer: harness.approvalReviewer,
        lintGate: harness.lintGate,
      });

    const firstResult = await runOnce();
    const secondResult = await runOnce();

    expect(firstResult).toMatchObject({ ok: true, created: true });
    expect(secondResult).toMatchObject({ ok: true, created: false });

    // Exactly one PR exists across both runs -- the second run pushed onto the
    // same branch and updated the PR the first run opened.
    expect(harness.prPublisher.createPr).toHaveBeenCalledTimes(1);
    expect(harness.prPublisher.updatePr).toHaveBeenCalledTimes(1);
    expect(harness.prPublisher.updatePr).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequest: { number: EXISTING_PR_NUMBER },
      }),
    );
    expect(harness.prPublisher.publishBranch).toHaveBeenCalledTimes(2);
  });
});

const buildStructuralCombination = (
  overrides: Partial<StructuralCombination> = {},
): StructuralCombination => ({
  namespace: 'admin',
  language: 'zh_CN',
  addedKeys: ['k3'],
  removedKeys: ['k2'],
  filePath: '/base/locales/zh_CN/admin.json',
  exportedContent: { k1: 'v1', k3: 'v3' },
  ...overrides,
});

const EXISTING_STRUCTURAL_PR_NUMBER = 9191;

interface StructuralHarness {
  readonly calls: string[];
  readonly writeLocaleFile: WriteLocaleFile;
  readonly prPublisher: StructuralPrPublisher;
}

const buildStructuralHarness = (): StructuralHarness => {
  const calls: string[] = [];

  const writeLocaleFile = vi.fn((absolutePath: string, _content: string) => {
    calls.push(`write:${absolutePath}`);
    return Promise.resolve();
  });

  // Stateful for the same reason as buildApplyHarness's prPublisher fake:
  // running the flow twice against this harness must reproduce the real
  // second-run situation (an unmerged PR already open).
  let openPullRequest: PullRequestRef | null = null;

  const prPublisher = mock<StructuralPrPublisher>();
  prPublisher.publishBranch.mockImplementation(() => {
    calls.push('publishBranch');
    return Promise.resolve();
  });
  prPublisher.findExistingPr.mockImplementation(() => {
    calls.push('findExistingPr');
    return Promise.resolve(openPullRequest);
  });
  prPublisher.createPr.mockImplementation(() => {
    calls.push('createPr');
    openPullRequest = { number: EXISTING_STRUCTURAL_PR_NUMBER };
    return Promise.resolve(openPullRequest);
  });
  prPublisher.updatePr.mockImplementation(() => {
    calls.push('updatePr');
    return Promise.resolve();
  });

  return { calls, writeLocaleFile, prPublisher };
};

describe('applyStructuralChanges', () => {
  it('does nothing at all when the structural group is empty', async () => {
    const harness = buildStructuralHarness();

    const result = await applyStructuralChanges({
      combinations: [],
      writeLocaleFile: harness.writeLocaleFile,
      prPublisher: harness.prPublisher,
    });

    expect(result).toEqual({ ok: true, outcome: 'no_changes' });
    expect(harness.calls).toEqual([]);
  });

  it('writes the exported content and opens a single review-required PR, with no approval step of any kind', async () => {
    const harness = buildStructuralHarness();
    const combinations = [
      buildStructuralCombination(),
      buildStructuralCombination({
        namespace: 'translation',
        language: 'fr_FR',
        addedKeys: [],
        removedKeys: ['t1'],
        filePath: '/base/locales/fr_FR/translation.json',
        exportedContent: { t2: 'b' },
      }),
    ];

    const result = await applyStructuralChanges({
      combinations,
      writeLocaleFile: harness.writeLocaleFile,
      prPublisher: harness.prPublisher,
    });

    expect(result).toEqual({
      ok: true,
      outcome: 'pr_ready',
      pullRequest: { number: EXISTING_STRUCTURAL_PR_NUMBER },
      created: true,
    });

    // No approval step exists in this call chain at all -- applyStructuralChanges's
    // own signature has no ApprovalReviewer parameter, so there is nothing to
    // assert "was not called" on beyond confirming the calls actually made are
    // exactly these four, in order.
    expect(harness.calls).toEqual([
      'write:/base/locales/zh_CN/admin.json',
      'write:/base/locales/fr_FR/translation.json',
      'publishBranch',
      'findExistingPr',
      'createPr',
    ]);

    expect(harness.writeLocaleFile).toHaveBeenCalledWith(
      '/base/locales/zh_CN/admin.json',
      `${JSON.stringify({ k1: 'v1', k3: 'v3' }, null, 2)}\n`,
    );
    expect(harness.prPublisher.publishBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        headBranch: STRUCTURAL_BRANCH,
        filePaths: [
          '/base/locales/zh_CN/admin.json',
          '/base/locales/fr_FR/translation.json',
        ],
      }),
    );
    expect(harness.prPublisher.createPr).toHaveBeenCalledWith(
      expect.objectContaining({ headBranch: STRUCTURAL_BRANCH }),
    );
  });

  it('updates the already-open structural PR instead of opening a second one when run twice on the same diff', async () => {
    const harness = buildStructuralHarness();
    const combinations = [buildStructuralCombination()];
    const runOnce = () =>
      applyStructuralChanges({
        combinations,
        writeLocaleFile: harness.writeLocaleFile,
        prPublisher: harness.prPublisher,
      });

    const firstResult = await runOnce();
    const secondResult = await runOnce();

    expect(firstResult).toMatchObject({ ok: true, created: true });
    expect(secondResult).toMatchObject({ ok: true, created: false });
    expect(harness.prPublisher.createPr).toHaveBeenCalledTimes(1);
    expect(harness.prPublisher.updatePr).toHaveBeenCalledTimes(1);
    expect(harness.prPublisher.updatePr).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequest: { number: EXISTING_STRUCTURAL_PR_NUMBER },
      }),
    );
  });
});

describe('translation-only-empty / structural-only integration', () => {
  it('creates only the structural review PR and never touches the approval bot or the translation-only publisher when the translation-only group is empty', async () => {
    // Runs both apply functions the way `runPull`/`main()` would, against a
    // translationOnly=[] / structural=[...] split.
    const translationOnlyHarness = buildApplyHarness({ lintGatePasses: true });
    const structuralHarness = buildStructuralHarness();
    const structuralCombinations = [buildStructuralCombination()];

    const translationOnlyResult = await applyTranslationOnlyChanges({
      combinations: [],
      writeLocaleFile: translationOnlyHarness.writeLocaleFile,
      prPublisher: translationOnlyHarness.prPublisher,
      approvalReviewer: translationOnlyHarness.approvalReviewer,
      lintGate: translationOnlyHarness.lintGate,
    });
    const structuralResult = await applyStructuralChanges({
      combinations: structuralCombinations,
      writeLocaleFile: structuralHarness.writeLocaleFile,
      prPublisher: structuralHarness.prPublisher,
    });

    expect(translationOnlyResult).toEqual({ ok: true, outcome: 'no_changes' });
    expect(structuralResult).toEqual({
      ok: true,
      outcome: 'pr_ready',
      pullRequest: { number: EXISTING_STRUCTURAL_PR_NUMBER },
      created: true,
    });

    // The approval bot is never invoked at all -- not "invoked zero times as
    // a side effect", but structurally never reached, since the empty
    // translation-only group short-circuits before touching any collaborator.
    expect(
      translationOnlyHarness.approvalReviewer.submitApprovalReview,
    ).toHaveBeenCalledTimes(0);
    expect(translationOnlyHarness.calls).toEqual([]);

    // Exactly one PR is created, and it is the structural review PR.
    expect(structuralHarness.prPublisher.createPr).toHaveBeenCalledTimes(1);
    expect(structuralHarness.prPublisher.createPr).toHaveBeenCalledWith(
      expect.objectContaining({ headBranch: STRUCTURAL_BRANCH }),
    );
  });
});

const buildRunPullHarness = () => {
  const translationOnlyHarness = buildApplyHarness({ lintGatePasses: true });
  const structuralHarness = buildStructuralHarness();
  return {
    poeditorClient: buildPoeditorClient(),
    translationOnlyPrPublisher: translationOnlyHarness.prPublisher,
    approvalReviewer: translationOnlyHarness.approvalReviewer,
    lintGate: translationOnlyHarness.lintGate,
    structuralPrPublisher: structuralHarness.prPublisher,
  };
};

describe('runPull', () => {
  it('returns ok:true when collectClassifications, applyTranslationOnlyChanges, and applyStructuralChanges all succeed', async () => {
    const harness = buildRunPullHarness();
    const collectClassificationsFn = vi.fn(async () => ({
      ok: true as const,
      translationOnly: [],
      structural: [],
      skipped: [],
    }));
    const applyTranslationOnlyChangesFn = vi.fn(async () => ({
      ok: true as const,
      outcome: 'no_changes' as const,
    }));
    const applyStructuralChangesFn = vi.fn(async () => ({
      ok: true as const,
      outcome: 'no_changes' as const,
    }));

    const result = await runPull({
      ...harness,
      collectClassificationsFn,
      applyTranslationOnlyChangesFn,
      applyStructuralChangesFn,
    });

    expect(result).toEqual({ ok: true, skipped: [] });
    expect(collectClassificationsFn).toHaveBeenCalledTimes(1);
    expect(applyTranslationOnlyChangesFn).toHaveBeenCalledTimes(1);
    expect(applyStructuralChangesFn).toHaveBeenCalledTimes(1);
  });

  it('aborts before either apply step when collectClassifications reports failure, and reports it in `failures`', async () => {
    const harness = buildRunPullHarness();
    const collectClassificationsFn = vi.fn(async () => ({
      ok: false as const,
      failures: [
        {
          namespace: 'admin' as const,
          language: 'ja_JP',
          reason: 'read_failed' as const,
          message: 'ENOENT',
        },
      ],
    }));
    const applyTranslationOnlyChangesFn = vi.fn();
    const applyStructuralChangesFn = vi.fn();

    const result = await runPull({
      ...harness,
      collectClassificationsFn,
      applyTranslationOnlyChangesFn,
      applyStructuralChangesFn,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toEqual([
        'collectClassifications: admin/ja_JP (read_failed)',
      ]);
    }
    expect(applyTranslationOnlyChangesFn).not.toHaveBeenCalled();
    expect(applyStructuralChangesFn).not.toHaveBeenCalled();
  });

  it('runs applyStructuralChanges even when applyTranslationOnlyChanges fails, and aggregates both messages when both fail', async () => {
    const harness = buildRunPullHarness();
    const collectClassificationsFn = vi.fn(async () => ({
      ok: true as const,
      translationOnly: [buildCombination()],
      structural: [buildStructuralCombination()],
      skipped: [],
    }));
    const applyTranslationOnlyChangesFn = vi.fn(async () => ({
      ok: false as const,
      reason: 'lint_gate_failed' as const,
      pullRequest: { number: EXISTING_PR_NUMBER },
      message: 'lint:i18n failed',
    }));
    // biome-ignore lint/suspicious/useAwait: must match applyStructuralChanges's Promise-returning signature.
    const applyStructuralChangesFn = vi.fn(async () => {
      throw new Error('structural publish exploded');
    });

    const result = await runPull({
      ...harness,
      collectClassificationsFn,
      applyTranslationOnlyChangesFn,
      applyStructuralChangesFn,
    });

    expect(applyTranslationOnlyChangesFn).toHaveBeenCalledTimes(1);
    expect(applyStructuralChangesFn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toEqual([
        'applyTranslationOnlyChanges: lint_gate_failed - lint:i18n failed',
        'applyStructuralChanges: structural publish exploded',
      ]);
    }
    // The actual classification.structural array must reach
    // applyStructuralChanges -- not an empty array or unrelated data. An
    // aggregate test that only checks call counts/order would still pass if
    // runPull dropped the real combinations on the floor.
    expect(applyStructuralChangesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        combinations: [buildStructuralCombination()],
      }),
    );
    expect(applyTranslationOnlyChangesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        combinations: [buildCombination()],
      }),
    );
  });

  it('calls applyTranslationOnlyChanges before applyStructuralChanges (gate must see the tree before structural writes land)', async () => {
    const harness = buildRunPullHarness();
    const callOrder: string[] = [];
    const collectClassificationsFn = vi.fn(async () => ({
      ok: true as const,
      translationOnly: [buildCombination()],
      structural: [buildStructuralCombination()],
      skipped: [],
    }));
    // biome-ignore lint/suspicious/useAwait: must match applyTranslationOnlyChanges's Promise-returning signature.
    const applyTranslationOnlyChangesFn = vi.fn(async () => {
      callOrder.push('applyTranslationOnlyChanges');
      return { ok: true as const, outcome: 'no_changes' as const };
    });
    // biome-ignore lint/suspicious/useAwait: must match applyStructuralChanges's Promise-returning signature.
    const applyStructuralChangesFn = vi.fn(async () => {
      callOrder.push('applyStructuralChanges');
      return { ok: true as const, outcome: 'no_changes' as const };
    });

    await runPull({
      ...harness,
      collectClassificationsFn,
      applyTranslationOnlyChangesFn,
      applyStructuralChangesFn,
    });

    expect(callOrder).toEqual([
      'applyTranslationOnlyChanges',
      'applyStructuralChanges',
    ]);
  });
});

describe('main', () => {
  // Every environment variable main() reads, saved and restored as a set so
  // one test's deletion cannot leak into the next.
  const ENV_KEYS = [
    'POEDITOR_API_TOKEN',
    'GITHUB_REPOSITORY',
    'GITHUB_TOKEN',
    'I18N_SYNC_PUBLISH_TOKEN',
    'I18N_SYNC_APPROVAL_TOKEN',
  ] as const;
  const originalEnv = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A complete, valid configuration by default; each test below narrows it
    // to the one thing it is about.
    process.env.POEDITOR_API_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'growilabs/growi';
    process.env.I18N_SYNC_PUBLISH_TOKEN = 'publish-token';
    process.env.I18N_SYNC_APPROVAL_TOKEN = 'approval-token';
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    process.exitCode = undefined;
    consoleErrorSpy.mockRestore();
  });

  it('sets a non-zero exit code and does not run the pull sequence when POEDITOR_API_TOKEN is not set', async () => {
    delete process.env.POEDITOR_API_TOKEN;
    const collectClassificationsFn = vi.fn();

    await main({ collectClassificationsFn });

    expect(process.exitCode).toBe(1);
    expect(collectClassificationsFn).not.toHaveBeenCalled();
  });

  it('refuses to run when the approval bot token is missing', async () => {
    delete process.env.I18N_SYNC_APPROVAL_TOKEN;
    const collectClassificationsFn = vi.fn();

    await main({ collectClassificationsFn });

    expect(process.exitCode).toBe(1);
    expect(collectClassificationsFn).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('I18N_SYNC_APPROVAL_TOKEN'),
    );
  });

  it('refuses to run when the approval bot token and the publishing token are the same value', async () => {
    // The separation between the pull-request author and the approving
    // identity is the whole reason `ApprovalReviewer` exists as its own
    // interface. One value wired to both roles would silently defeat it --
    // and GitHub refuses a self-approval anyway, so such a run could never
    // merge.
    process.env.I18N_SYNC_PUBLISH_TOKEN = 'same-token';
    process.env.I18N_SYNC_APPROVAL_TOKEN = 'same-token';
    const collectClassificationsFn = vi.fn();

    await main({ collectClassificationsFn });

    expect(process.exitCode).toBe(1);
    expect(collectClassificationsFn).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('must be a different identity'),
    );
  });

  it('refuses to run when the repository is not identified', async () => {
    delete process.env.GITHUB_REPOSITORY;
    const collectClassificationsFn = vi.fn();

    await main({ collectClassificationsFn });

    expect(process.exitCode).toBe(1);
    expect(collectClassificationsFn).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('GITHUB_REPOSITORY'),
    );
  });

  it('wires the real GitHub adapters, giving the approving identity no way to write content', async () => {
    let capturedApprovalReviewer: ApprovalReviewer | undefined;
    let capturedStructuralPublisher: StructuralPrPublisher | undefined;

    await main({
      collectClassificationsFn: vi.fn(async () => ({
        ok: true as const,
        translationOnly: [],
        structural: [],
        skipped: [],
      })),
      // biome-ignore lint/suspicious/useAwait: must match applyTranslationOnlyChanges's Promise-returning signature.
      applyTranslationOnlyChangesFn: vi.fn(async (options) => {
        capturedApprovalReviewer = options.approvalReviewer;
        return { ok: true as const, outcome: 'no_changes' as const };
      }),
      // biome-ignore lint/suspicious/useAwait: must match applyStructuralChanges's Promise-returning signature.
      applyStructuralChangesFn: vi.fn(async (options) => {
        capturedStructuralPublisher = options.prPublisher;
        return { ok: true as const, outcome: 'no_changes' as const };
      }),
    });

    // The approving identity's adapter carries exactly one capability; there
    // is no method on it that could commit, push, or edit a pull request.
    expect(Object.keys(capturedApprovalReviewer ?? {})).toEqual([
      'submitApprovalReview',
    ]);
    // ...while the structural publisher is a real publisher, with no
    // approval capability of its own.
    expect(Object.keys(capturedStructuralPublisher ?? {}).sort()).toEqual([
      'createPr',
      'findExistingPr',
      'publishBranch',
      'updatePr',
    ]);
    expect(capturedStructuralPublisher).not.toHaveProperty(
      'submitApprovalReview',
    );
  });

  it('accepts the workflow-provided GITHUB_TOKEN as the publishing identity when no dedicated publish token is configured, and warns about it', async () => {
    // GitHub Actions exports an unregistered secret as an empty string, not
    // as an unset variable -- `delete` does not model what Actions actually
    // produces here.
    process.env.I18N_SYNC_PUBLISH_TOKEN = '';
    process.env.GITHUB_TOKEN = 'workflow-token';
    const collectClassificationsFn = vi.fn(async () => ({
      ok: true as const,
      translationOnly: [],
      structural: [],
      skipped: [],
    }));
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await main({
      collectClassificationsFn,
      applyTranslationOnlyChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
      applyStructuralChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
    });

    expect(process.exitCode).toBeUndefined();
    expect(collectClassificationsFn).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('I18N_SYNC_PUBLISH_TOKEN is not set'),
    );
  });

  it('leaves the exit code unset when every step succeeds (success path through main())', async () => {
    await main({
      collectClassificationsFn: vi.fn(async () => ({
        ok: true as const,
        translationOnly: [],
        structural: [],
        skipped: [],
      })),
      applyTranslationOnlyChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
      applyStructuralChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
    });

    expect(process.exitCode).toBeUndefined();
  });

  it('sets a non-zero exit code when any step reports failure', async () => {
    await main({
      collectClassificationsFn: vi.fn(async () => ({
        ok: true as const,
        translationOnly: [],
        structural: [buildStructuralCombination()],
        skipped: [],
      })),
      applyTranslationOnlyChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
      // biome-ignore lint/suspicious/useAwait: must match applyStructuralChanges's Promise-returning signature.
      applyStructuralChangesFn: vi.fn(async () => {
        throw new Error('GitHub API unreachable');
      }),
    });

    expect(process.exitCode).toBe(1);
  });

  it('warns about skipped (invalid_json) combinations on the success path, but leaves the exit code unset', async () => {
    // A combination whose POEditor export failed to parse must never
    // disappear silently even though the overall run still succeeds -- see
    // this file's header comment and the `skipped` field's doc comment.
    await main({
      collectClassificationsFn: vi.fn(async () => ({
        ok: true as const,
        translationOnly: [],
        structural: [],
        skipped: [
          {
            namespace: 'admin' as const,
            language: 'zh_CN',
            reason: 'invalid_json' as const,
            message: 'Unexpected token < in JSON at position 0',
          },
        ],
      })),
      applyTranslationOnlyChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
      applyStructuralChangesFn: vi.fn(async () => ({
        ok: true as const,
        outcome: 'no_changes' as const,
      })),
    });

    expect(process.exitCode).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('admin/zh_CN'),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected token < in JSON at position 0'),
    );
  });
});
