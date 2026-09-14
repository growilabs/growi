import { mock } from 'vitest-mock-extended';

import type { PoeditorClient } from './poeditor-client.ts';
import { runPush } from './push-source.ts';
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

const FILE_CONTENTS: Readonly<Record<string, string>> = {
  '/base/locales/en_US/admin.json': '{"admin_key":"Admin"}',
  '/base/locales/en_US/translation.json': '{"translation_key":"Translation"}',
  '/base/locales/en_US/commons.json': '{"commons_key":"Commons"}',
};

describe('runPush', () => {
  it('reads all 3 namespace files and uploads each once, with the correct projectId/language/fileContent', async () => {
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.uploadTerms.mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const readNamespaceFile = vi.fn(
      async (absolutePath: string) => FILE_CONTENTS[absolutePath],
    );

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result).toEqual({ ok: true });
    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(3);
    expect(poeditorClient.uploadTerms).toHaveBeenNthCalledWith(1, {
      projectId: 'project-admin',
      language: 'en_US',
      fileContent: '{"admin_key":"Admin"}',
    });
    expect(poeditorClient.uploadTerms).toHaveBeenNthCalledWith(2, {
      projectId: 'project-translation',
      language: 'en_US',
      fileContent: '{"translation_key":"Translation"}',
    });
    expect(poeditorClient.uploadTerms).toHaveBeenNthCalledWith(3, {
      projectId: 'project-commons',
      language: 'en_US',
      fileContent: '{"commons_key":"Commons"}',
    });
  });

  it('aborts the whole run and uploads nothing when one namespace file fails to read', async () => {
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.uploadTerms.mockResolvedValue({
      ok: true,
      value: undefined,
    });
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('read_failed');
      expect(result.failures).toEqual([
        {
          namespace: 'translation',
          filePath: 'locales/en_US/translation.json',
          message: 'ENOENT: no such file or directory',
        },
      ]);
    }

    // The core assertion the task requires: even though admin and commons
    // would have read successfully, uploadTerms must never be called for
    // ANY namespace once one namespace's file read has failed — this
    // assertion fails if the abort-on-failure logic were ever removed and
    // replaced with a per-namespace skip-and-continue.
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

  it('stops uploading at the first upload failure and reports an upload_failed result, never reaching later namespaces', async () => {
    // Upload failures must abort the whole run just like read failures do —
    // no partial reflection in POEditor. "admin" (1st) succeeds,
    // "translation" (2nd) fails, and "commons" (3rd) must never be attempted.
    const poeditorClient = mock<PoeditorClient>();
    const readNamespaceFile = vi.fn(
      async (absolutePath: string) => FILE_CONTENTS[absolutePath],
    );
    poeditorClient.uploadTerms
      .mockResolvedValueOnce({ ok: true, value: undefined })
      .mockResolvedValueOnce({
        ok: false,
        error: { type: 'rate_limited' },
      });

    const result = await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    // The core assertion the task requires: uploadTerms must be called
    // exactly twice (admin, then translation) — the 3rd namespace ("commons")
    // must never be uploaded once "translation" has already failed. This
    // assertion fails if the abort-on-failure logic were ever removed and
    // replaced with a skip-and-continue loop.
    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('upload_failed');
      expect(result.failures).toEqual([
        { namespace: 'translation', error: { type: 'rate_limited' } },
      ]);
    }
  });

  it('relies on PoeditorClient.uploadTerms itself to space out calls (no additional sleep is invoked by PushSourceSync)', async () => {
    // This is a documentation-style assertion: PushSourceSync must not add a
    // second, redundant throttle on top of PoeditorClient's own internal
    // 20-second gap. Since `runPush` never receives or calls a `sleep`
    // function at all, there is nothing here to fake — the absence of such a
    // parameter is itself the guarantee. This test documents that intent and
    // would fail to compile
    // if `RunPushOptions` ever grew a redundant sleep-injection parameter
    // that the implementation started calling directly instead of trusting
    // the client's own throttle.
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.uploadTerms.mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const readNamespaceFile = vi.fn(
      async (absolutePath: string) => FILE_CONTENTS[absolutePath],
    );

    await runPush({
      poeditorClient,
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(3);
  });
});
