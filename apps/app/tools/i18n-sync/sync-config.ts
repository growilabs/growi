/**
 * The single source of truth for the namespace <-> POEditor project ID
 * mapping. `PushSourceSync` / `PullTranslationSync` read `SYNC_TARGETS`
 * rather than hard-coding a namespace name or project ID themselves.
 */

export interface NamespaceSyncEntry {
  readonly namespace: 'admin' | 'translation' | 'commons';
  /**
   * POEditor project ID for this namespace's dedicated project. Public,
   * non-secret data — safe to commit (it is not a token).
   *
   * Placeholder value: the 3 POEditor projects have not been created yet.
   * Replace with the real IDs once
   * `docs/i18n-community-translation-setup.md`'s provisioning steps run.
   */
  readonly poeditorProjectId: string;
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
 * (`admin.json` / `translation.json` / `commons.json`), each mapped to its
 * own POEditor project. `packages/editor`'s `toolbar.*` keys already live
 * inside `translation.json`, so they need no separate declaration here.
 */
export const SYNC_TARGETS: readonly NamespaceSyncEntry[] = [
  {
    namespace: 'admin',
    poeditorProjectId: 'PENDING_ADMIN_PROJECT_ID',
    localeFilePath: buildLocaleFilePath('admin'),
  },
  {
    namespace: 'translation',
    poeditorProjectId: 'PENDING_TRANSLATION_PROJECT_ID',
    localeFilePath: buildLocaleFilePath('translation'),
  },
  {
    namespace: 'commons',
    poeditorProjectId: 'PENDING_COMMONS_PROJECT_ID',
    localeFilePath: buildLocaleFilePath('commons'),
  },
];
