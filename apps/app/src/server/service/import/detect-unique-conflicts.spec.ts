import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  collectConflicts,
  type GroupUniqueFields,
  hasConflicts,
  readArchiveUserIdentity,
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

describe('readArchiveUserIdentity', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'archive-user-identity-'),
    );
  });

  afterEach(async () => {
    await fs.rm(workDir, { force: true, recursive: true });
  });

  const writeUsersJson = async (content: string): Promise<string> => {
    const jsonPath = path.join(workDir, 'users.json');
    await fs.writeFile(jsonPath, content, 'utf-8');
    return jsonPath;
  };

  test('returns every username, email, slackMemberId and _id the archive carries', async () => {
    // The admin rescue picks a replacement username out of these sets, so a value the
    // archive holds but this function omits becomes a duplicate-key failure at re-insertion.
    const jsonPath = await writeUsersJson(
      JSON.stringify([
        {
          _id: '0123456789abcdef01230001',
          username: 'alice',
          email: 'alice@example.com',
          slackMemberId: 'UALICE',
          password: 'source-password-hash',
        },
        {
          _id: '0123456789abcdef01230002',
          username: 'bob',
          email: 'bob@example.com',
          slackMemberId: 'UBOB',
        },
      ]),
    );

    const identity = await readArchiveUserIdentity(jsonPath);

    expect([...identity.usernames].sort()).toEqual(['alice', 'bob']);
    expect([...identity.emails].sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect([...identity.slackMemberIds].sort()).toEqual(['UALICE', 'UBOB']);
    expect([...identity.ids].sort()).toEqual([
      '0123456789abcdef01230001',
      '0123456789abcdef01230002',
    ]);
  });

  test('leaves absent and empty sparse values out of the sets', async () => {
    // A rescued account may keep an absent email; "no value" must not read as a collision.
    const jsonPath = await writeUsersJson(
      JSON.stringify([
        { _id: '0123456789abcdef01230001', username: 'alice', email: '' },
        { _id: '0123456789abcdef01230002', username: 'bob', email: null },
        { _id: '0123456789abcdef01230003', username: 'carol' },
      ]),
    );

    const identity = await readArchiveUserIdentity(jsonPath);

    expect(identity.emails.size).toBe(0);
    expect(identity.slackMemberIds.size).toBe(0);
    expect(identity.usernames.size).toBe(3);
  });

  test('returns empty sets for an archive that holds no user', async () => {
    const jsonPath = await writeUsersJson('[]');

    const identity = await readArchiveUserIdentity(jsonPath);

    expect(identity.usernames.size).toBe(0);
    expect(identity.emails.size).toBe(0);
    expect(identity.slackMemberIds.size).toBe(0);
    expect(identity.ids.size).toBe(0);
  });

  test('rejects a truncated archive instead of returning a partial set', async () => {
    // A partial set is worse than no set at all: the rescue would pick a username the
    // source actually uses and the re-insertion would fail the unique index.
    const jsonPath = await writeUsersJson(
      '[{"_id":"0123456789abcdef01230001","username":"alice"}',
    );

    await expect(readArchiveUserIdentity(jsonPath)).rejects.toThrow(
      /complete top-level array/,
    );
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
