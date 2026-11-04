import { generateOverwriteParams } from '~/server/service/import/overwrite-params';

import {
  buildMergeTransferPlan,
  buildMigrationTransferPlan,
  COLLECTIONS_EXCLUDED_FROM_COHERENCE,
  FORCED_MODE_COLLECTIONS,
  isCoherentOptionsMap,
} from './g2g-transfer-preset';
import { GrowiArchiveImportOption } from './growi-archive-import-option';
import { ImportMode } from './import-mode';
import { ImportOptionForPages } from './import-option-for-pages';
import { ImportOptionForRevisions } from './import-option-for-revisions';

// A representative slice of the collections a migration transfer carries: two
// collections whose import method the system forces (`configs`, `pages`) alongside
// ordinary ones, so the plan-building tests exercise both branches.
const TRANSFERABLE_COLLECTIONS_FIXTURE = [
  'configs',
  'users',
  'usergroups',
  'usergrouprelations',
  'externalaccounts',
  'pages',
  'revisions',
];

describe('buildMigrationTransferPlan', () => {
  it('targets every transferable collection without asking the operator to choose', () => {
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);

    expect(plan.collections).toEqual(TRANSFERABLE_COLLECTIONS_FIXTURE);
  });

  it('assigns replace to every collection, including the ones the system already forces to replace', () => {
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);

    for (const collectionName of TRANSFERABLE_COLLECTIONS_FIXTURE) {
      expect(plan.optionsMap[collectionName]?.mode).toBe(
        ImportMode.flushAndInsert,
      );
    }
  });

  it('carries every extra option key pages needs, so the receiving side does not reject it', () => {
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);

    expect(plan.optionsMap.pages).toMatchObject({
      mode: ImportMode.flushAndInsert,
      isOverwriteAuthorWithCurrentUser: false,
      makePublicForGrant2: false,
      makePublicForGrant4: false,
      makePublicForGrant5: false,
      initPageMetadatas: false,
    });
  });

  it('carries the extra option key revisions needs', () => {
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);

    expect(plan.optionsMap.revisions).toMatchObject({
      mode: ImportMode.flushAndInsert,
      isOverwriteAuthorWithCurrentUser: false,
    });
  });

  it.each([
    ['pages', new ImportOptionForPages('pages')],
    ['revisions', new ImportOptionForRevisions('revisions')],
  ])('keeps the %s extra options equal to the defaults their own option class ships', (collectionName, defaults) => {
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);

    // The plan must carry the shipped defaults, not a restatement of them. This
    // fails if either option class changes a default without this module following
    // — the drift the module cannot catch on its own, because
    // ImportOptionForRevisions does not `declare` its field and so cannot be read
    // back with type checking. The round-trip is how the option travels to the
    // receiving side anyway (it is serialised onto the wire).
    const {
      collectionName: _,
      mode: __,
      ...shippedDefaults
    } = JSON.parse(JSON.stringify(defaults));

    expect(plan.optionsMap[collectionName]).toMatchObject(shippedDefaults);
  });

  it.each([
    'pages',
    'revisions',
  ])('feeds the %s option straight into the receiving side’s import-settings generation without throwing', (collectionName) => {
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);
    const rawOption = plan.optionsMap[collectionName];

    // Mirrors what the receiving side's getImportSettingMap does with a wire-arrived
    // optionsMap entry (service/g2g-transfer.ts): wrap it in a GrowiArchiveImportOption,
    // then hand it to generateOverwriteParams. That function decides pages/revisions
    // eligibility by whether 'isOverwriteAuthorWithCurrentUser' exists on the option at
    // all (isImportOptionForPages), not by its value, and throws "Invalid option for
    // pages/revisions" when it is absent -- this is the guard a missing key would trip.
    const option = new GrowiArchiveImportOption(
      collectionName,
      undefined,
      rawOption,
    );

    expect(() =>
      generateOverwriteParams(collectionName, 'operatorUserId', option),
    ).not.toThrow();
  });

  it('produces a plan that satisfies the coherence condition it will be checked against', () => {
    // The receiving route refuses an incoherent plan, so a migration plan that fails
    // its own condition would be refused before it ever runs. This breaks if a
    // collection with a forced method other than replace is added to
    // FORCED_MODE_COLLECTIONS without also being excluded from the judgement.
    const plan = buildMigrationTransferPlan(TRANSFERABLE_COLLECTIONS_FIXTURE);

    expect(isCoherentOptionsMap(plan.optionsMap, plan.collections)).toBe(true);
  });
});

describe('buildMergeTransferPlan', () => {
  it('uses exactly the operator’s selection and options, unchanged', () => {
    const selected = ['users', 'pages'];
    const optionsMap = {
      users: { mode: ImportMode.insert },
      pages: {
        mode: ImportMode.upsert,
        isOverwriteAuthorWithCurrentUser: false,
        makePublicForGrant2: false,
        makePublicForGrant4: false,
        makePublicForGrant5: false,
        initPageMetadatas: false,
      },
    };

    const plan = buildMergeTransferPlan(selected, optionsMap);

    expect(plan.collections).toEqual(selected);
    expect(plan.optionsMap).toEqual(optionsMap);
  });
});

describe('isCoherentOptionsMap', () => {
  it('treats configs=replace + users=append as coherent (the ordinary merge-preset shape)', () => {
    const optionsMap = {
      configs: { mode: ImportMode.flushAndInsert },
      users: { mode: ImportMode.insert },
    };

    expect(isCoherentOptionsMap(optionsMap, ['configs', 'users'])).toBe(true);
  });

  it('treats replacing every non-forced collection as coherent', () => {
    const optionsMap = {
      users: { mode: ImportMode.flushAndInsert },
      usergroups: { mode: ImportMode.flushAndInsert },
    };

    expect(isCoherentOptionsMap(optionsMap, ['users', 'usergroups'])).toBe(
      true,
    );
  });

  it('treats replacing nothing as coherent', () => {
    const optionsMap = {
      users: { mode: ImportMode.insert },
      usergroups: { mode: ImportMode.upsert },
    };

    expect(isCoherentOptionsMap(optionsMap, ['users', 'usergroups'])).toBe(
      true,
    );
  });

  it('rejects a mix of replace and append outside the forced collections', () => {
    const optionsMap = {
      users: { mode: ImportMode.flushAndInsert },
      usergroups: { mode: ImportMode.insert },
    };

    expect(isCoherentOptionsMap(optionsMap, ['users', 'usergroups'])).toBe(
      false,
    );
  });

  it('excludes pages from the judgement, so replacing pages alone while appending everything else stays coherent', () => {
    // Requirement 1.3: pages can never be a plain insert (only replace or upsert are
    // legal), so "replace pages, append everything else" is an existing, legal
    // merge-preset combination -- not a mixed assignment -- and must not be refused.
    const optionsMap = {
      pages: { mode: ImportMode.flushAndInsert },
      users: { mode: ImportMode.insert },
    };

    expect(isCoherentOptionsMap(optionsMap, ['pages', 'users'])).toBe(true);
  });

  it('ignores a leftover option for a collection no longer in the transfer', () => {
    // Requirement 5.8: excludeNonTransferableCollections narrows `collections` but may
    // leave a contradicting entry behind in `optionsMap` for a dropped collection; that
    // leftover must not be read as a mixed assignment.
    const optionsMap = {
      users: { mode: ImportMode.insert },
      transferkeys: { mode: ImportMode.flushAndInsert },
    };

    expect(isCoherentOptionsMap(optionsMap, ['users'])).toBe(true);
  });
});

describe('COLLECTIONS_EXCLUDED_FROM_COHERENCE and FORCED_MODE_COLLECTIONS', () => {
  it('excludes exactly configs and pages from the coherence judgement', () => {
    expect([...COLLECTIONS_EXCLUDED_FROM_COHERENCE].sort()).toEqual([
      'configs',
      'pages',
    ]);
  });

  it('forces configs to replace, and does not force pages to a single mode', () => {
    expect(FORCED_MODE_COLLECTIONS.get('configs')).toBe(
      ImportMode.flushAndInsert,
    );
    expect(FORCED_MODE_COLLECTIONS.has('pages')).toBe(false);
  });
});
