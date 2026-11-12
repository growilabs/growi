import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Guards the 17 keys that "Non-Existent Key Reference Fix" (task 3.1, commit
 * bc2a76e0f2) added as brand-new JSON entries across all 5 locales, as
 * opposed to the 8 other items in the same 25-item cleanup that were
 * resolved by repointing a call site at an already-existing key ("参照修正").
 * A repointed reference does not need this check the same way a new key
 * does: it points at a key that, by definition, already had a value in every
 * locale before this feature touched anything.
 *
 * This list intentionally excludes the `No users have liked this yet`
 * (no trailing period) fr_FR addition from the same commit: that add filled
 * a locale gap for a key that already existed in the other 4 locales, not a
 * key that was net-new everywhere.
 *
 * Per design.md's Testing Strategy, this test is the enforcement mechanism
 * for an ordering requirement that has no other automated guard: the
 * Baseline Store's first `--update-baseline` run (task 8.1) must not happen
 * before every new key has a real value in all 5 locales, or the recorded
 * baseline would silently bake in the still-missing translations as "normal".
 */

type Namespace = 'admin' | 'commons' | 'translation';

interface NewKey {
  readonly namespace: Namespace;
  /** Dot-separated path into the namespace JSON, e.g. 'editor_guide.textstyle.copy_failed'. */
  readonly keyPath: string;
}

const NEW_KEYS: readonly NewKey[] = [
  // admin.json (6)
  { namespace: 'admin', keyPath: 'Page' },
  { namespace: 'admin', keyPath: 'Execute' },
  { namespace: 'admin', keyPath: 'Enable' },
  { namespace: 'admin', keyPath: 'Copied!' },
  { namespace: 'admin', keyPath: 'ExternalUserGroup' },
  { namespace: 'admin', keyPath: 'something_went_wrong' },
  // commons.json (3)
  { namespace: 'commons', keyPath: 'View' },
  { namespace: 'commons', keyPath: 'Send' },
  { namespace: 'commons', keyPath: 'Clear' },
  // translation.json (8)
  { namespace: 'translation', keyPath: 'Not available for read only user' },
  { namespace: 'translation', keyPath: 'User Settings' },
  { namespace: 'translation', keyPath: 'Slack Member ID' },
  { namespace: 'translation', keyPath: 'Successfully updated' },
  { namespace: 'translation', keyPath: 'Failed to update' },
  { namespace: 'translation', keyPath: 'Forbidden' },
  { namespace: 'translation', keyPath: 'editor_guide.textstyle.copy_failed' },
  { namespace: 'translation', keyPath: 'editor_guide.decoration.alert_block' },
];

const LOCALES = ['en_US', 'ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'] as const;

const localesDir = path.resolve(
  import.meta.dirname,
  '../../public/static/locales',
);

const readNamespaceJson = (locale: string, namespace: Namespace): unknown => {
  const filePath = path.join(localesDir, locale, `${namespace}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

/**
 * Mirrors i18next's keySeparator ('.') resolution for a nested lookup path.
 * Keys in NEW_KEYS that are themselves plain strings (e.g. 'Copied!') have no
 * '.' and resolve as a single top-level lookup, same as everything else here.
 */
const resolveKeyPath = (namespaceJson: unknown, keyPath: string): unknown => {
  return keyPath.split('.').reduce<unknown>((acc, segment) => {
    if (acc != null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, namespaceJson);
};

describe('new keys added by the Non-Existent Key Reference Fix have a non-empty value in every locale', () => {
  it('declares at least one key per touched namespace (guards against an empty/vacuous list)', () => {
    const namespacesCovered = new Set(NEW_KEYS.map((k) => k.namespace));
    expect(namespacesCovered).toEqual(
      new Set(['admin', 'commons', 'translation']),
    );
  });

  describe.each(NEW_KEYS)('$namespace: $keyPath', ({ namespace, keyPath }) => {
    it.each(LOCALES)('has a non-empty value in %s', (locale) => {
      const namespaceJson = readNamespaceJson(locale, namespace);
      const value = resolveKeyPath(namespaceJson, keyPath);

      expect(typeof value).toBe('string');
      expect((value as string).trim().length).toBeGreaterThan(0);
    });
  });
});
