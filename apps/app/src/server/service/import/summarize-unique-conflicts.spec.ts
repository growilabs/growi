import type {
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

const report = (
  overrides: Partial<UniqueConflictReport>,
): UniqueConflictReport => ({
  userConflicts: [],
  groupConflicts: [],
  ...overrides,
});

describe('summarizeUniqueConflicts', () => {
  test('names each conflicting collection with its conflict count', () => {
    // Requirement 3.1 — the operator has to learn which kind conflicted, and how much.
    const summary = summarizeUniqueConflicts(
      report({
        userConflicts: [
          userConflict('email', 'admin@example.com'),
          userConflict('username', 'admin'),
        ],
        groupConflicts: [groupConflict('engineering')],
      }),
    );

    expect(summary).toContain('users: 2 conflicts');
    expect(summary).toContain('usergroups: 1 conflict');
  });

  test('quotes the conflicting field name and value so the operator can identify the document', () => {
    // Requirement 3.2 — "which unique field, with which value" must be recoverable.
    const summary = summarizeUniqueConflicts(
      report({ userConflicts: [userConflict('email', 'admin@example.com')] }),
    );

    expect(summary).toContain('email');
    expect(summary).toContain('admin@example.com');
  });

  test('states that a collection has no conflicts instead of inventing a count', () => {
    const summary = summarizeUniqueConflicts(
      report({ groupConflicts: [groupConflict('engineering')] }),
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
        report({
          userConflicts: values.map((value) => userConflict('email', value)),
        }),
      );

      const quoted = values.filter((value) => summary.includes(value));
      expect(quoted).toEqual(values.slice(0, CONFLICT_SAMPLE_LIMIT));
      expect(summary).toContain('users: 5 conflicts');
      expect(summary).toContain(`and ${5 - CONFLICT_SAMPLE_LIMIT} more`);
    });

    test('does not append a remainder note when every conflict fits in the samples', () => {
      const summary = summarizeUniqueConflicts(
        report({ userConflicts: [userConflict('username', 'admin')] }),
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
      report({ userConflicts: [userConflict('username', 'admin')] }),
    );

    expect(summary).toMatch(/not imported|no collection was imported/i);
  });
});
