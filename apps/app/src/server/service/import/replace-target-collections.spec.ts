import { ImportMode } from '~/models/admin/import-mode';

import type { ImportSettings } from './import-settings';
import { deriveReplaceTargets } from './replace-target-collections';

const importSettings = (mode: ImportMode): ImportSettings => ({
  mode,
  jsonFileName: 'irrelevant.json',
  overwriteParams: {},
});

describe('deriveReplaceTargets', () => {
  test('names only the collections that will be emptied first', () => {
    const result = deriveReplaceTargets(
      new Map([
        ['configs', importSettings(ImportMode.flushAndInsert)],
        ['users', importSettings(ImportMode.insert)],
        ['pages', importSettings(ImportMode.upsert)],
        ['usergroups', importSettings(ImportMode.flushAndInsert)],
      ]),
    );

    expect([...result].sort()).toEqual(['configs', 'usergroups']);
  });

  test('is empty when nothing is replaced', () => {
    const result = deriveReplaceTargets(
      new Map([
        ['users', importSettings(ImportMode.insert)],
        ['pages', importSettings(ImportMode.upsert)],
      ]),
    );

    expect([...result]).toEqual([]);
  });

  test('reads the settings that arrived rather than any notion of a transfer mode', () => {
    // The destination is never told which mode the operator chose. Deriving the set from
    // the settings is what keeps a new mode on the sending side from needing a change
    // here.
    const migrationLike = new Map([
      ['users', importSettings(ImportMode.flushAndInsert)],
      ['usergroups', importSettings(ImportMode.flushAndInsert)],
    ]);

    expect([...deriveReplaceTargets(migrationLike)].sort()).toEqual([
      'usergroups',
      'users',
    ]);
  });
});
