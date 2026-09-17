import { mock } from 'vitest-mock-extended';

import type { PoeditorClient } from './poeditor-client.ts';
import { runSeed } from './seed-existing-translations.ts';
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
  '/base/locales/ja_JP/admin.json': '{"admin_key":"管理"}',
  '/base/locales/ja_JP/translation.json': '{"shared_key":"翻訳"}',
  // Deliberately repeats `shared_key` from the translation namespace: this
  // mirrors commons.json's intentional duplication of translation.json keys
  // (Requirement 1.2), so the assertions below prove the combined payload
  // keeps them apart per namespace rather than collapsing them.
  '/base/locales/ja_JP/commons.json': '{"shared_key":"共通"}',
};

/** The POEditor language code ja_JP must be converted to before any API call (Requirement 4.1). */
const POEDITOR_JA_LANGUAGE = 'ja';

const mockReadNamespaceFile = () =>
  vi.fn(async (absolutePath: string) => FILE_CONTENTS[absolutePath]);

const okClient = () => {
  const poeditorClient = mock<PoeditorClient>();
  poeditorClient.uploadTerms.mockResolvedValue({ ok: true, value: undefined });
  return poeditorClient;
};

describe('runSeed', () => {
  it('uploads the given non-source language once, non-destructively and without a tag', async () => {
    const poeditorClient = okClient();

    const result = await runSeed({
      poeditorClient,
      language: 'ja_JP',
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    expect(result).toEqual({ ok: true });

    // Exactly one upload for the whole language, unlike push's combined +
    // per-namespace tagging uploads: tags were already set when en_US was
    // pushed, and this call must never converge/delete (syncTerms: false).
    expect(poeditorClient.uploadTerms).toHaveBeenCalledTimes(1);

    const [call] = poeditorClient.uploadTerms.mock.calls[0];
    expect(call.projectId).toBe(SHARED_POEDITOR_PROJECT_ID);
    expect(call.language).toBe(POEDITOR_JA_LANGUAGE);
    expect(call.syncTerms).toBe(false);
    expect(call.tag).toBeUndefined();
    // The payload must stay nested per namespace, same collision guard as
    // PushSourceSync's combined upload.
    expect(JSON.parse(call.fileContent)).toEqual({
      admin: { admin_key: '管理' },
      translation: { shared_key: '翻訳' },
      commons: { shared_key: '共通' },
    });
  });

  it('aborts before uploading anything when a namespace file fails to read', async () => {
    const poeditorClient = okClient();
    // biome-ignore lint/suspicious/useAwait: must match ReadNamespaceFile's Promise-returning signature.
    const readNamespaceFile = vi.fn(async (absolutePath: string) => {
      if (absolutePath === '/base/locales/ja_JP/commons.json') {
        throw new Error('ENOENT: no such file');
      }
      return FILE_CONTENTS[absolutePath];
    });

    const result = await runSeed({
      poeditorClient,
      language: 'ja_JP',
      targets: TEST_TARGETS,
      readNamespaceFile,
      baseDir: '/base',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'read_failed',
      failures: [
        {
          namespace: 'commons',
          filePath: 'locales/ja_JP/commons.json',
          message: 'ENOENT: no such file',
        },
      ],
    });
    expect(poeditorClient.uploadTerms).not.toHaveBeenCalled();
  });

  it('reports upload_failed when the upload call fails', async () => {
    const poeditorClient = mock<PoeditorClient>();
    poeditorClient.uploadTerms.mockResolvedValue({
      ok: false,
      error: { type: 'rate_limited' },
    });

    const result = await runSeed({
      poeditorClient,
      language: 'ja_JP',
      targets: TEST_TARGETS,
      readNamespaceFile: mockReadNamespaceFile(),
      baseDir: '/base',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'upload_failed',
      error: { type: 'rate_limited' },
    });
  });
});
