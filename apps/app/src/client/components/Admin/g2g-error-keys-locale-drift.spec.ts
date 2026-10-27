import fs from 'node:fs';
import path from 'node:path';

import { KEYS_WITH_DETAIL_MESSAGE } from './g2g-error-toast-contents';

/**
 * Guards the mapping between the `admin:g2g:*` keys the pusher emits
 * (`server/service/g2g-transfer.ts`, `admin:g2gError` socket payload's `key`
 * field) and `en_US/admin.json`. Read-only against both files — this does not
 * modify `g2g-transfer.ts` (out of this task's boundary).
 *
 * Keys are extracted from the pusher's source rather than hardcoded, so a
 * future key addition/rename is caught automatically instead of silently
 * drifting (a hardcoded expectation list would stay green even if the pusher
 * started emitting a key with no translation — which is exactly what
 * happened to `error_upload_attachment` before this spec: emitted since
 * `service/g2g-transfer.ts` existed, but absent from every locale's `g2g`
 * object until this task added it to en_US).
 */

const readPusherSource = (): string => {
  const pusherSourcePath = path.resolve(
    import.meta.dirname,
    '../../../server/service/g2g-transfer.ts',
  );
  return fs.readFileSync(pusherSourcePath, 'utf-8');
};

const readAdminLocale = (): unknown => {
  const adminLocalePath = path.resolve(
    import.meta.dirname,
    '../../../../public/static/locales/en_US/admin.json',
  );
  return JSON.parse(fs.readFileSync(adminLocalePath, 'utf-8'));
};

/**
 * Mirrors i18next's own key resolution for `t('admin:g2g:foo')`: nsSeparator
 * (':') splits the whole string, the first segment ('admin') is the
 * namespace, and the remaining segments are re-joined with keySeparator ('.')
 * to form the nested lookup path — see i18next's `Translator#extractFromKey`
 * (config confirmed default: no custom nsSeparator/keySeparator in
 * config/i18next.config.mjs). For our `admin:g2g:xxx` keys this simplifies to
 * "namespace object -> g2g -> xxx".
 */
const resolveKeyInNamespace = (
  namespaceJson: unknown,
  key: string,
): unknown => {
  const [, ...path_] = key.split(':');
  return path_.reduce<unknown>((acc, segment) => {
    if (acc != null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, namespaceJson);
};

describe("admin:g2g:* keys the pusher emits resolve in en_US/admin.json's g2g object", () => {
  const pusherSource = readPusherSource();
  const emittedKeys = [
    ...new Set(pusherSource.match(/admin:g2g:[a-zA-Z0-9_]+/g) ?? []),
  ];
  const adminLocale = readAdminLocale();

  it('found at least one admin:g2g: key in the pusher source (guards against an empty/vacuous walk)', () => {
    expect(emittedKeys.length).toBeGreaterThan(0);
  });

  it.each(
    emittedKeys.map((key): [string] => [key]),
  )('%s resolves to a non-empty translated string', (key) => {
    const value = resolveKeyInNamespace(adminLocale, key);
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });

  /**
   * A key listed for a detail toast that the pusher no longer emits would drop the
   * conflict summary — requirements 3.1/3.2 — while the heading keeps appearing, so
   * nothing looks broken. Renaming the pusher's key alone does not surface it either:
   * the locale check above goes red, and adding the new locale entry turns it green
   * again with the detail silently gone.
   */
  it.each(
    KEYS_WITH_DETAIL_MESSAGE.map((key): [string] => [key]),
  )('%s is still a key the pusher emits', (key) => {
    expect(emittedKeys).toContain(key);
  });
});
