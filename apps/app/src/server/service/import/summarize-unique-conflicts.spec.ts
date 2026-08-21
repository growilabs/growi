import type {
  CollectionName,
  UniqueConflictReport,
  UniqueFieldConflict,
} from './detect-unique-conflicts';
import {
  CONFLICT_SAMPLE_LIMIT,
  summarizeUniqueConflicts,
} from './summarize-unique-conflicts';

const userConflict = (
  field: UniqueFieldConflict['field'],
  value: string,
): UniqueFieldConflict => ({
  collection: 'users',
  field,
  value,
  archiveId: `archive-${value}`,
  existingId: `existing-${value}`,
});

const groupConflict = (value: string): UniqueFieldConflict => ({
  collection: 'usergroups',
  field: 'name',
  value,
  archiveId: `archive-${value}`,
  existingId: `existing-${value}`,
});

// A composite-key conflict's `value` is the JSON.stringify'd array of field values, in
// the same order as the `+`-joined field names in `field` (see toReportedValue /
// UniqueKeySpec.label in detect-unique-conflicts.ts).
const externalAccountConflict = (
  providerType: string,
  accountId: string,
): UniqueFieldConflict => ({
  collection: 'externalaccounts',
  field: 'providerType+accountId',
  value: JSON.stringify([providerType, accountId]),
  archiveId: `archive-${providerType}-${accountId}`,
  existingId: `existing-${providerType}-${accountId}`,
});

const externalUserGroupIdConflict = (
  externalId: string,
): UniqueFieldConflict => ({
  collection: 'externalusergroups',
  field: 'externalId',
  value: externalId,
  archiveId: `archive-${externalId}`,
  existingId: `existing-${externalId}`,
});

const externalUserGroupNameProviderConflict = (
  name: string,
  provider: string,
): UniqueFieldConflict => ({
  collection: 'externalusergroups',
  field: 'name+provider',
  value: JSON.stringify([name, provider]),
  archiveId: `archive-${name}-${provider}`,
  existingId: `existing-${name}-${provider}`,
});

// Builds a report from exactly the collection entries given -- unlike `legacyReport`
// below, a collection not listed here is genuinely absent from the Map (the sparse case
// task 3.2 introduced for a collection that was not part of the transfer at all).
const mapReport = (
  entries: readonly (readonly [
    CollectionName,
    readonly UniqueFieldConflict[],
  ])[],
): UniqueConflictReport => ({
  conflictsByCollection: new Map(entries),
});

// Mirrors the pre-task-4 test helper's default: `users` and `usergroups` are always
// present (empty array when not overridden), matching how a real report looks when both
// collections are part of the transfer and only some of them have conflicts.
const legacyReport = (
  overrides: Partial<
    Record<'users' | 'usergroups', readonly UniqueFieldConflict[]>
  >,
): UniqueConflictReport =>
  mapReport([
    ['users', overrides.users ?? []],
    ['usergroups', overrides.usergroups ?? []],
  ]);

describe('summarizeUniqueConflicts', () => {
  test('names each conflicting collection with its conflict count', () => {
    // Requirement 3.1 — the operator has to learn which kind conflicted, and how much.
    const summary = summarizeUniqueConflicts(
      legacyReport({
        users: [
          userConflict('email', 'admin@example.com'),
          userConflict('username', 'admin'),
        ],
        usergroups: [groupConflict('engineering')],
      }),
    );

    expect(summary).toContain('users: 2 conflicts');
    expect(summary).toContain('usergroups: 1 conflict');
  });

  test('quotes the conflicting field name and value so the operator can identify the document', () => {
    // Requirement 3.2 — "which unique field, with which value" must be recoverable.
    const summary = summarizeUniqueConflicts(
      legacyReport({ users: [userConflict('email', 'admin@example.com')] }),
    );

    expect(summary).toContain('email');
    expect(summary).toContain('admin@example.com');
  });

  test('states that a collection has no conflicts instead of inventing a count', () => {
    // Regression: a collection present in the Map with zero conflicts (checked and
    // found clean) still gets an explicit "no conflicts" section -- distinct from a
    // collection that is absent from the Map entirely (not part of the transfer; see
    // the sparse-map test below).
    const summary = summarizeUniqueConflicts(
      legacyReport({ usergroups: [groupConflict('engineering')] }),
    );

    expect(summary).toContain('users: no conflicts');
    expect(summary).toContain('usergroups: 1 conflict');
    expect(summary).toContain('engineering');
  });

  describe('exposure of conflicting values', () => {
    test('quotes at most the sample limit per collection and reports the rest as a count only', () => {
      // Security Considerations — conflicting values are user data (e-mail addresses,
      // slack member ids). The notification carries representative examples plus a
      // count, never the whole list.
      const values = [
        'sample-1@example.com',
        'sample-2@example.com',
        'sample-3@example.com',
        'withheld-4@example.com',
        'withheld-5@example.com',
      ];
      const summary = summarizeUniqueConflicts(
        legacyReport({
          users: values.map((value) => userConflict('email', value)),
        }),
      );

      const quoted = values.filter((value) => summary.includes(value));
      expect(quoted).toEqual(values.slice(0, CONFLICT_SAMPLE_LIMIT));
      expect(summary).toContain('users: 5 conflicts');
      expect(summary).toContain(`and ${5 - CONFLICT_SAMPLE_LIMIT} more`);
    });

    test('does not append a remainder note when every conflict fits in the samples', () => {
      const summary = summarizeUniqueConflicts(
        legacyReport({ users: [userConflict('username', 'admin')] }),
      );

      expect(summary).not.toContain('more');
    });

    test('keeps the sample limit small enough to stay a sample', () => {
      // A limit that grows to "all of them" would silently undo the constraint above.
      expect(CONFLICT_SAMPLE_LIMIT).toBeLessThanOrEqual(5);
    });
  });

  test('reports that nothing was imported so the operator does not treat the transfer as done', () => {
    // Requirement 2.2 — the transfer must not read as successful.
    const summary = summarizeUniqueConflicts(
      legacyReport({ users: [userConflict('username', 'admin')] }),
    );

    expect(summary).toMatch(/not imported|no collection was imported/i);
  });

  test('summarizes externalaccounts composite-key conflicts with per-field identifying values', () => {
    // Requirement 3.1 for the newly-covered collection: providerType+accountId is a
    // composite key, so the operator must be able to tell which value belongs to which
    // field, not just see an opaque combined string.
    const summary = summarizeUniqueConflicts(
      mapReport([
        ['externalaccounts', [externalAccountConflict('saml', 'user-x')]],
      ]),
    );

    expect(summary).toContain('externalaccounts: 1 conflict');
    expect(summary).toContain('providerType=saml');
    expect(summary).toContain('accountId=user-x');
  });

  test('summarizes externalusergroups externalId (single-field) conflicts', () => {
    const summary = summarizeUniqueConflicts(
      mapReport([
        ['externalusergroups', [externalUserGroupIdConflict('ext-123')]],
      ]),
    );

    expect(summary).toContain('externalusergroups: 1 conflict');
    expect(summary).toContain('externalId "ext-123"');
  });

  test('summarizes externalusergroups name+provider (composite) conflicts', () => {
    const summary = summarizeUniqueConflicts(
      mapReport([
        [
          'externalusergroups',
          [externalUserGroupNameProviderConflict('engineering', 'saml')],
        ],
      ]),
    );

    expect(summary).toContain('externalusergroups: 1 conflict');
    expect(summary).toContain('name=engineering');
    expect(summary).toContain('provider=saml');
  });

  test('reports conflicts across multiple collections independently', () => {
    const summary = summarizeUniqueConflicts(
      mapReport([
        ['users', [userConflict('email', 'admin@example.com')]],
        ['externalaccounts', [externalAccountConflict('ldap', 'user-y')]],
      ]),
    );

    expect(summary).toContain('users: 1 conflict');
    expect(summary).toContain('admin@example.com');
    expect(summary).toContain('externalaccounts: 1 conflict');
    expect(summary).toContain('providerType=ldap');
    expect(summary).toContain('accountId=user-y');
  });

  test('renders no section for a collection absent from a sparse map (not part of the transfer)', () => {
    const summary = summarizeUniqueConflicts(
      mapReport([['users', [userConflict('username', 'admin')]]]),
    );

    expect(summary).not.toContain('usergroups');
    expect(summary).not.toContain('externalaccounts');
    expect(summary).not.toContain('externalusergroups');
  });

  test('produces just the opening message when the map has no entries at all', () => {
    const summary = summarizeUniqueConflicts(mapReport([]));

    expect(summary).toMatch(/not imported|no collection was imported/i);
    expect(summary).not.toContain('users');
    expect(summary).not.toContain('usergroups');
  });
});
