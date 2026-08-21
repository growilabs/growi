import { ImportMode } from '~/models/admin/import-mode';

import type { ImportSettings } from './import-settings';

/**
 * The collections this import will empty before writing to them.
 *
 * Everything the receiving side has to decide — whether a unique-constraint conflict can
 * still happen, whether the destination's own accounts are about to disappear — follows
 * from this set and nothing else. In particular it is derived from the import settings
 * that arrived, not from the name of a transfer mode: the destination is never told which
 * mode the operator picked, and adding a mode must not mean teaching this side about it.
 */
export function deriveReplaceTargets(
  importSettingsMap: ReadonlyMap<string, ImportSettings>,
): ReadonlySet<string> {
  const replaceTargets = new Set<string>();

  for (const [collectionName, importSettings] of importSettingsMap) {
    if (importSettings.mode === ImportMode.flushAndInsert) {
      replaceTargets.add(collectionName);
    }
  }

  return replaceTargets;
}
