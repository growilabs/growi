import {
  collectConflicts,
  type GroupUniqueFields,
  hasConflicts,
  type UniqueConflictReport,
  type UserUniqueFields,
} from './detect-unique-conflicts';

describe('collectConflicts', () => {
  describe('users collection', () => {
    test('flags a username match with a different _id as a conflict', () => {
      // Requirement 1.1
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', username: 'alice' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', username: 'alice' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        'username',
      ]);

      expect(result).toEqual([
        {
          collection: 'users',
          field: 'username',
          value: 'alice',
          archiveId: 'archive-user-1',
          existingId: 'existing-user-1',
        },
      ]);
    });

    test('flags an email match with a different _id as a conflict', () => {
      // Requirement 1.2
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', email: 'admin@example.com' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', email: 'admin@example.com' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        'email',
      ]);

      expect(result).toEqual([
        {
          collection: 'users',
          field: 'email',
          value: 'admin@example.com',
          archiveId: 'archive-user-1',
          existingId: 'existing-user-1',
        },
      ]);
    });

    test('flags a slackMemberId match with a different _id as a conflict', () => {
      // Requirement 1.3
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', slackMemberId: 'U123ABC' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', slackMemberId: 'U123ABC' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        'slackMemberId',
      ]);

      expect(result).toEqual([
        {
          collection: 'users',
          field: 'slackMemberId',
          value: 'U123ABC',
          archiveId: 'archive-user-1',
          existingId: 'existing-user-1',
        },
      ]);
    });

    test('does not flag a matching value as a conflict when the _id is the same document', () => {
      // Requirement 1.5: re-importing the same document must not be a conflict.
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'same-id', username: 'alice', email: 'alice@example.com' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'same-id', username: 'alice', email: 'alice@example.com' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        'username',
        'email',
      ]);

      expect(result).toEqual([]);
    });

    test.each([
      ['null vs null', null, null],
      ['undefined vs undefined', undefined, undefined],
      ['empty string vs empty string', '', ''],
      ['null vs undefined', null, undefined],
      ['empty string vs null', '', null],
    ])('does not flag sparse field %s as a conflict', (_label, archiveValue, existingValue) => {
      // Sparse unique fields (email, slackMemberId): absence-of-value must not collide.
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', email: archiveValue },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', email: existingValue },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        'email',
      ]);

      expect(result).toEqual([]);
    });

    test('enumerates one conflict per field when the same document conflicts on multiple fields', () => {
      const archiveDocs: UserUniqueFields[] = [
        {
          _id: 'archive-user-1',
          username: 'alice',
          email: 'alice@example.com',
        },
      ];
      const existingDocs: UserUniqueFields[] = [
        {
          _id: 'existing-user-1',
          username: 'alice',
          email: 'alice@example.com',
        },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        'username',
        'email',
      ]);

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        collection: 'users',
        field: 'username',
        value: 'alice',
        archiveId: 'archive-user-1',
        existingId: 'existing-user-1',
      });
      expect(result).toContainEqual({
        collection: 'users',
        field: 'email',
        value: 'alice@example.com',
        archiveId: 'archive-user-1',
        existingId: 'existing-user-1',
      });
    });
  });

  describe('usergroups collection', () => {
    test('flags a name match with a different _id as a conflict', () => {
      // Requirement 1.4
      const archiveDocs: GroupUniqueFields[] = [
        { _id: 'archive-group-1', name: 'Engineering' },
      ];
      const existingDocs: GroupUniqueFields[] = [
        { _id: 'existing-group-1', name: 'Engineering' },
      ];

      const result = collectConflicts('usergroups', archiveDocs, existingDocs, [
        'name',
      ]);

      expect(result).toEqual([
        {
          collection: 'usergroups',
          field: 'name',
          value: 'Engineering',
          archiveId: 'archive-group-1',
          existingId: 'existing-group-1',
        },
      ]);
    });

    test('does not flag a matching name as a conflict when the _id is the same document', () => {
      // Requirement 1.5
      const archiveDocs: GroupUniqueFields[] = [
        { _id: 'same-id', name: 'Engineering' },
      ];
      const existingDocs: GroupUniqueFields[] = [
        { _id: 'same-id', name: 'Engineering' },
      ];

      const result = collectConflicts('usergroups', archiveDocs, existingDocs, [
        'name',
      ]);

      expect(result).toEqual([]);
    });
  });
});

describe('hasConflicts', () => {
  test('returns false when both userConflicts and groupConflicts are empty', () => {
    const report: UniqueConflictReport = {
      userConflicts: [],
      groupConflicts: [],
    };

    expect(hasConflicts(report)).toBe(false);
  });

  test('returns true when userConflicts has at least one entry', () => {
    const report: UniqueConflictReport = {
      userConflicts: [
        {
          collection: 'users',
          field: 'username',
          value: 'alice',
          archiveId: 'archive-user-1',
          existingId: 'existing-user-1',
        },
      ],
      groupConflicts: [],
    };

    expect(hasConflicts(report)).toBe(true);
  });

  test('returns true when groupConflicts has at least one entry', () => {
    const report: UniqueConflictReport = {
      userConflicts: [],
      groupConflicts: [
        {
          collection: 'usergroups',
          field: 'name',
          value: 'Engineering',
          archiveId: 'archive-group-1',
          existingId: 'existing-group-1',
        },
      ],
    };

    expect(hasConflicts(report)).toBe(true);
  });
});
