/**
 * The single source of truth for the namespace <-> locale file mapping.
 * `PushSourceSync` / `PullTranslationSync` read `SYNC_TARGETS` rather than
 * hard-coding a namespace name themselves.
 */

/**
 * POEditor project ID for the single shared project all namespaces sync
 * into. Public, non-secret data — safe to commit (it is not a token).
 *
 * Placeholder value: the shared POEditor project has not been created yet.
 * Replace with the real ID once
 * `docs/i18n-community-translation-setup.md`'s provisioning steps run.
 */
export const SHARED_POEDITOR_PROJECT_ID = 'PENDING_SHARED_PROJECT_ID';

export interface NamespaceSyncEntry {
  readonly namespace: 'admin' | 'translation' | 'commons';
  /**
   * Resolves this namespace's locale file path for a given language,
   * relative to the apps/app root (e.g. "en_US" ->
   * "public/static/locales/en_US/admin.json").
   */
  readonly localeFilePath: (lang: string) => string;
}

const buildLocaleFilePath = (
  namespace: NamespaceSyncEntry['namespace'],
): NamespaceSyncEntry['localeFilePath'] => {
  return (lang: string) => `public/static/locales/${lang}/${namespace}.json`;
};

/**
 * The 3 real namespaces the repository has locale files for
 * (`admin.json` / `translation.json` / `commons.json`), all synced into
 * the single shared POEditor project (`SHARED_POEDITOR_PROJECT_ID`).
 * `packages/editor`'s `toolbar.*` keys already live inside
 * `translation.json`, so they need no separate declaration here.
 */
export const SYNC_TARGETS: readonly NamespaceSyncEntry[] = [
  {
    namespace: 'admin',
    localeFilePath: buildLocaleFilePath('admin'),
  },
  {
    namespace: 'translation',
    localeFilePath: buildLocaleFilePath('translation'),
  },
  {
    namespace: 'commons',
    localeFilePath: buildLocaleFilePath('commons'),
  },
];
