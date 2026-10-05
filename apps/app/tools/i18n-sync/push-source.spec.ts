import { mock } from 'vitest-mock-extended';

import type { PoeditorClient } from './poeditor-client.ts';
import { runPush } from './push-source.ts';
import {
  type NamespaceSyncEntry,
  SHARED_POEDITOR_PROJECT_ID,
} from './sync-config.ts';

// A small 3-entry fixture mirroring the shape of the real SYNC_TARGETS
// (admin/translation/commons), injected via `targets` so this test never
// depends on the real locale file paths declared in sync-config.ts.
const TEST_TARGETS: readonly NamespaceSyncEntry[] = [
  {
    namespace: 'admin',
    localeFilePath: (lang) => `locales/${lang}/admin.json`,
  },
  {
    namespace: 'translation',
    localeFilePath: (lang) => `locales/${lang}/translation.json`,
  },
  {
    namespace: 'commons',
    localeFilePath: (lang) => `locales/${lang}/commons.json`,
  },
];

const FILE_CONTENTS: Readonly<Record<string, string>> = {
  '/base/locales/en_US/admin.json': '{"admin_key":"Admin"}',
  '/base/locales/en_US/translation.json': '{"shared_key":"Translation"}',
  // Deliberately repeats `shared_key` from the translation namespace: this
  // mirrors commons.json's intentional duplication of translation.json keys
  // (Requirement 1.2), so the assertions below prove the combined payload
  // keeps them apart per namespace rather than collapsing them.
  '/base/locales/en_US/commons.json': '{"shared_key":"Commons"}',
};

/** The POEditor language code en_US must be converted to before any API call (Requirement 4.1). */
const POEDITOR_SOURCE_LANGUAGE = 'en-us';

const mockReadNamespaceFile = () =>
  vi.fn(async (absolutePath: string) => FILE_CONTENTS[absolutePath]);

const okClient = () => {
  const poeditorClient = mock<PoeditorClient>();
  poeditorClient.uploadTerms.mockResolvedValue({ ok: true, value: undefined });
  return poeditorClient;
};

describe('runPush', () => {
  it('converges the whole project with a single combined upload, then tags each namespace with a non-destructive upload', async () => {
    const poeditorClient = okClient();

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    expect(result).toEqual({ ok: true });

    // 1 combined upload + 1 tagging upload per namespace.
    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(
      1 + TEST_TARGETS.length,
    );

    const [combinedCall] = poeditorClient.uploadTerms.mock.calls[0];
    expect(combinedCall.projectId).toBe(SHARED_POEDITOR_PROJECT_ID);
    expect(combinedCall.language).toBe(POEDITOR_SOURCE_LANGUAGE);
    expect(combinedCall.tag).toBeUndefined();
    // en_US is authoritative: a wording change to an existing key must
    // replace POEditor's copy (POEditor's own default is to keep the old
    // value -- see research.md's overwrite-default Decision).
    expect(combinedCall.overwrite).toBe(true);
    // The combined payload must stay nested per namespace. A flat merge would
    // let commons' `shared_key` overwrite translation's — exactly the
    // collision Requirement 1.2 exists to prevent.
    expect(JSON.parse(combinedCall.fileContent)).toEqual({
      admin: { admin_key: 'Admin' },
      translation: { shared_key: 'Translation' },
      commons: { shared_key: 'Commons' },
    });

    const tagCalls = poeditorClient.uploadTerms.mock.calls
      .slice(1)
      .map(([input]) => input);
    expect(tagCalls.map((input) => input.tag)).toEqual([
      'admin',
      'translation',
      'commons',
    ]);
    for (const input of tagCalls) {
      expect(input.projectId).toBe(SHARED_POEDITOR_PROJECT_ID);
      expect(input.language).toBe(POEDITOR_SOURCE_LANGUAGE);
      expect(input.syncTerms).toBe(false);
      // The combined upload already wrote the authoritative value moments
      // earlier; the tagging upload only needs to assign a tag.
      expect(input.overwrite).toBeUndefined();
    }
    expect(JSON.parse(tagCalls[0].fileContent)).toEqual({
      admin: { admin_key: 'Admin' },
    });
    expect(JSON.parse(tagCalls[1].fileContent)).toEqual({
      translation: { shared_key: 'Translation' },
    });
    expect(JSON.parse(tagCalls[2].fileContent)).toEqual({
      commons: { shared_key: 'Commons' },
    });
  });

  it("passes the POEditor language code (en), never GROWI's locale code (en_US), to every upload", async () => {
    // Requirement 4.1: POEditor rejects `en_US` with "Wrong language code",
    // so the conversion must happen for the combined upload AND every tagging
    // upload — not just the first call.
    const poeditorClient = okClient();

    await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    const languages = poeditorClient.uploadTerms.mock.calls.map(
      ([input]) => input.language,
    );
    expect(languages).toHaveLength(1 + TEST_TARGETS.length);
    expect(new Set(languages)).toEqual(new Set([POEDITOR_SOURCE_LANGUAGE]));
  });

  it('never issues more than one deletion-converging upload, and that one upload carries every namespace (regression guard for the sync_terms mutual-deletion bug)', async () => {
    // MUTATION TEST — this is the whole reason push is a two-stage flow.
    //
    // POEditor's `sync_terms` converges the ENTIRE project to the uploaded
    // file: every term absent from that file is deleted. Uploading each
    // namespace separately with `sync_terms` enabled therefore makes each
    // call delete the namespaces uploaded before it, leaving only the last
    // one (reproduced against the real POEditor project — see the amend
    // spec's research.md).
    //
    // Both halves of the invariant are asserted together on purpose:
    //   (a) exactly one upload converges, and it is the first one;
    //   (b) that upload's payload contains every namespace.
    // (a) alone would also pass for an implementation that never converges at
    // all; (b) alone would pass for one that converges repeatedly. Regressing
    // to a per-namespace converging loop breaks (a); regressing to a partial
    // combined payload breaks (b).
    const poeditorClient = okClient();

    await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    // `syncTerms` omitted means the default (true) applies in PoeditorClient,
    // so an omitted value counts as converging here.
    const convergingCallIndexes = poeditorClient.uploadTerms.mock.calls
      .map(([input], index) => ({ index, converging: input.syncTerms ?? true }))
      .filter(({ converging }) => converging)
      .map(({ index }) => index);

    expect(convergingCallIndexes).toEqual([0]);

    const [combinedCall] = poeditorClient.uploadTerms.mock.calls[0];
    expect(Object.keys(JSON.parse(combinedCall.fileContent)).sort()).toEqual(
      TEST_TARGETS.map((target) => target.namespace).sort(),
    );
  });

  it('aborts the whole run and uploads nothing when one namespace file fails to read', async () => {
    const poeditorClient = okClient();
    // Simulate an ENOENT on the "translation" namespace file specifically —
    // "admin" and "commons" would succeed if read individually, so this
    // proves the abort is a whole-run decision, not a per-namespace one.
    const readNamespaceFile = vi.fn((absolutePath: string): Promise<string> => {
      if (absolutePath === '/base/locales/en_US/translation.json') {
        throw new Error('ENOENT: no such file or directory');
      }
      return Promise.resolve(FILE_CONTENTS[absolutePath]);
    });

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'read_failed',
      failures: [
        {
          namespace: 'translation',
          filePath: 'locales/en_US/translation.json',
          message: 'ENOENT: no such file or directory',
        },
      ],
    });

    // The core assertion: even though admin and commons would have read
    // successfully, uploadTerms must never be called — not the combined
    // upload, not any tagging upload — once one namespace's file read has
    // failed. This fails if the abort-on-failure logic were ever replaced
    // with a per-namespace skip-and-continue.
    expect(poeditorClient.uploadTerms).not.toHaveBeenCalled();
  });

  it('treats an unparseable namespace file as a read failure and uploads nothing', async () => {
    // The combined upload needs parsed JSON, so a syntactically broken locale
    // file is discovered in the read phase. Reporting it as `read_failed`
    // keeps the "nothing is uploaded unless every namespace is usable"
    // guarantee intact instead of converging POEditor to a partial project.
    const poeditorClient = okClient();
    const readNamespaceFile = vi.fn((absolutePath: string) => {
      if (absolutePath === '/base/locales/en_US/commons.json') {
        return Promise.resolve('{"broken": ');
      }
      return Promise.resolve(FILE_CONTENTS[absolutePath]);
    });

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    // Asserted on the result as a whole first, so the narrowed block below is
    // guaranteed to run; the failure's `message` is the JSON parser's own
    // wording, which is not worth pinning down.
    expect(result).toMatchObject({ ok: false, reason: 'read_failed' });
    if (!result.ok && result.reason === 'read_failed') {
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({
        namespace: 'commons',
        filePath: 'locales/en_US/commons.json',
      });
    }
    expect(poeditorClient.uploadTerms).not.toHaveBeenCalled();
  });

  it('returns a non-ok result (which the CLI entrypoint turns into a non-zero exit code) on a read failure', async () => {
    const poeditorClient = mock<PoeditorClient>();
    const readNamespaceFile = vi.fn(() => {
      throw new Error('permission denied');
    });

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result.ok).toBe(false);
  });

  it('skips every tagging upload when the combined upload fails', async () => {
    // Tagging uploads only make sense once the project's content has actually
    // converged, so a failed combined upload must leave uploadTerms called
    // exactly once for the whole run.
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.uploadTerms.mockResolvedValue({
      ok: false,
      error: { type: 'rate_limited' },
    });

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      reason: 'combined_upload_failed',
      error: { type: 'rate_limited' },
    });
  });

  it('stops at the first failing tagging upload and never tags the remaining namespaces', async () => {
    // Call 1 = combined upload (ok), call 2 = admin tag (ok),
    // call 3 = translation tag (fails) -> commons must never be tagged.
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.uploadTerms
      .mockResolvedValueOnce({ ok: true, value: undefined })
      .mockResolvedValueOnce({ ok: true, value: undefined })
      .mockResolvedValueOnce({ ok: false, error: { type: 'rate_limited' } });

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      ok: false,
      reason: 'tag_upload_failed',
      namespace: 'translation',
      error: { type: 'rate_limited' },
    });
  });

  it('relies on PoeditorClient.uploadTerms itself to space out calls (no additional sleep is invoked by PushSourceSync)', async () => {
    // This is a documentation-style assertion: PushSourceSync must not add a
    // second, redundant throttle on top of PoeditorClient's own internal
    // 20-second gap. Since `runPush` never receives or calls a `sleep`
    // function at all, there is nothing here to fake — the absence of such a
    // parameter is itself the guarantee. This test documents that intent and
    // would fail to compile if `RunPushOptions` ever grew a redundant
    // sleep-injection parameter that the implementation started calling
    // directly instead of trusting the client's own throttle.
    const poeditorClient = okClient();

    await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(
      1 + TEST_TARGETS.length,
    );
  });
});
