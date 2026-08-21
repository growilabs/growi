import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  collectConflicts,
  EXTERNAL_ACCOUNT_UNIQUE_KEYS,
  EXTERNAL_USER_GROUP_UNIQUE_KEYS,
  type ExternalAccountUniqueFields,
  type ExternalUserGroupUniqueFields,
  findExistingCandidates,
  type GroupUniqueFields,
  hasConflicts,
  pickExternalAccountUniqueFields,
  pickExternalUserGroupUniqueFields,
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
        { label: 'username', fields: ['username'] },
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
        { label: 'email', fields: ['email'] },
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
        { label: 'slackMemberId', fields: ['slackMemberId'] },
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
        { label: 'username', fields: ['username'] },
        { label: 'email', fields: ['email'] },
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
        { label: 'email', fields: ['email'] },
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
        { label: 'username', fields: ['username'] },
        { label: 'email', fields: ['email'] },
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
        { label: 'name', fields: ['name'] },
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
        { label: 'name', fields: ['name'] },
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('externalaccounts collection', () => {
    test('flags a providerType+accountId match with a different _id as a conflict', () => {
      // Requirement 1.1: externalaccounts' composite unique index is {providerType, accountId}.
      const archiveDocs: ExternalAccountUniqueFields[] = [
        { _id: 'archive-account-1', providerType: 'saml', accountId: 'user-a' },
      ];
      const existingDocs: ExternalAccountUniqueFields[] = [
        {
          _id: 'existing-account-1',
          providerType: 'saml',
          accountId: 'user-a',
        },
      ];

      const result = collectConflicts(
        'externalaccounts',
        archiveDocs,
        existingDocs,
        EXTERNAL_ACCOUNT_UNIQUE_KEYS,
      );

      expect(result).toEqual([
        {
          collection: 'externalaccounts',
          field: 'providerType+accountId',
          value: JSON.stringify(['saml', 'user-a']),
          archiveId: 'archive-account-1',
          existingId: 'existing-account-1',
        },
      ]);
    });

    test('does not flag a conflict when only one of providerType/accountId matches', () => {
      // Requirement 1.1: a partial match on the composite key is not a conflict.
      const archiveDocs: ExternalAccountUniqueFields[] = [
        { _id: 'archive-account-1', providerType: 'saml', accountId: 'user-a' },
      ];
      const existingDocs: ExternalAccountUniqueFields[] = [
        {
          _id: 'existing-account-1',
          providerType: 'saml',
          accountId: 'user-b',
        },
      ];

      const result = collectConflicts(
        'externalaccounts',
        archiveDocs,
        existingDocs,
        EXTERNAL_ACCOUNT_UNIQUE_KEYS,
      );

      expect(result).toEqual([]);
    });

    test('pickExternalAccountUniqueFields normalises a raw document to string fields', () => {
      const picked = pickExternalAccountUniqueFields({
        _id: { toString: () => 'raw-id' },
        providerType: 'ldap',
        accountId: 'cn=alice',
      });

      expect(picked).toEqual({
        _id: 'raw-id',
        providerType: 'ldap',
        accountId: 'cn=alice',
      });
    });
  });

  describe('externalusergroups collection', () => {
    test('flags an externalId match with a different _id as a conflict', () => {
      // Requirement 1.3: externalusergroups' externalId is a single-field unique key.
      const archiveDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'archive-group-1',
          externalId: 'cn=engineers,ou=groups',
          name: null,
          provider: null,
        },
      ];
      const existingDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'existing-group-1',
          externalId: 'cn=engineers,ou=groups',
          name: null,
          provider: null,
        },
      ];

      const result = collectConflicts(
        'externalusergroups',
        archiveDocs,
        existingDocs,
        EXTERNAL_USER_GROUP_UNIQUE_KEYS,
      );

      expect(result).toEqual([
        {
          collection: 'externalusergroups',
          field: 'externalId',
          value: 'cn=engineers,ou=groups',
          archiveId: 'archive-group-1',
          existingId: 'existing-group-1',
        },
      ]);
    });

    test('flags a name+provider match with a different _id as a conflict', () => {
      // Requirement 1.4: externalusergroups' name+provider is a composite unique key,
      // independent of the externalId key above.
      const archiveDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'archive-group-2',
          externalId: null,
          name: 'engineers',
          provider: 'ldap',
        },
      ];
      const existingDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'existing-group-2',
          externalId: null,
          name: 'engineers',
          provider: 'ldap',
        },
      ];

      const result = collectConflicts(
        'externalusergroups',
        archiveDocs,
        existingDocs,
        EXTERNAL_USER_GROUP_UNIQUE_KEYS,
      );

      expect(result).toEqual([
        {
          collection: 'externalusergroups',
          field: 'name+provider',
          value: JSON.stringify(['engineers', 'ldap']),
          archiveId: 'archive-group-2',
          existingId: 'existing-group-2',
        },
      ]);
    });

    test('does not flag a conflict when only name matches and provider differs', () => {
      // Requirement 1.4: a partial match on the composite key is not a conflict.
      const archiveDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'archive-group-3',
          externalId: null,
          name: 'engineers',
          provider: 'ldap',
        },
      ];
      const existingDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'existing-group-3',
          externalId: null,
          name: 'engineers',
          provider: 'saml',
        },
      ];

      const result = collectConflicts(
        'externalusergroups',
        archiveDocs,
        existingDocs,
        EXTERNAL_USER_GROUP_UNIQUE_KEYS,
      );

      expect(result).toEqual([]);
    });

    test('does not flag a conflict when only provider matches and name differs', () => {
      // Requirement 1.4: a partial match on the composite key is not a conflict.
      const archiveDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'archive-group-4',
          externalId: null,
          name: 'engineers',
          provider: 'ldap',
        },
      ];
      const existingDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'existing-group-4',
          externalId: null,
          name: 'sales',
          provider: 'ldap',
        },
      ];

      const result = collectConflicts(
        'externalusergroups',
        archiveDocs,
        existingDocs,
        EXTERNAL_USER_GROUP_UNIQUE_KEYS,
      );

      expect(result).toEqual([]);
    });

    test('detects an externalId conflict independently of a non-matching name+provider', () => {
      // The two keys in EXTERNAL_USER_GROUP_UNIQUE_KEYS are evaluated independently: a
      // document can conflict on externalId while its name+provider does not match at all.
      const archiveDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'archive-group-5',
          externalId: 'cn=engineers,ou=groups',
          name: 'archive-only-name',
          provider: 'ldap',
        },
      ];
      const existingDocs: ExternalUserGroupUniqueFields[] = [
        {
          _id: 'existing-group-5',
          externalId: 'cn=engineers,ou=groups',
          name: 'existing-only-name',
          provider: 'saml',
        },
      ];

      const result = collectConflicts(
        'externalusergroups',
        archiveDocs,
        existingDocs,
        EXTERNAL_USER_GROUP_UNIQUE_KEYS,
      );

      expect(result).toEqual([
        {
          collection: 'externalusergroups',
          field: 'externalId',
          value: 'cn=engineers,ou=groups',
          archiveId: 'archive-group-5',
          existingId: 'existing-group-5',
        },
      ]);
    });

    test('pickExternalUserGroupUniqueFields normalises a raw document to string fields', () => {
      const picked = pickExternalUserGroupUniqueFields({
        _id: { toString: () => 'raw-id' },
        externalId: 'cn=engineers,ou=groups',
        name: 'engineers',
        provider: 'ldap',
      });

      expect(picked).toEqual({
        _id: 'raw-id',
        externalId: 'cn=engineers,ou=groups',
        name: 'engineers',
        provider: 'ldap',
      });
    });
  });

  describe('composite key', () => {
    const compositeKey = {
      label: 'username+email',
      fields: ['username', 'email'],
    } as const;

    test('does not flag a conflict when only one of the two fields matches', () => {
      // Requirement 1.2: a partial match on a composite unique key is not a conflict.
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', username: 'alice', email: 'alice@a.example' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', username: 'alice', email: 'alice@b.example' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        compositeKey,
      ]);

      expect(result).toEqual([]);
    });

    test('flags a conflict when every field of the key matches under a different _id', () => {
      // Requirement 1.1 / 1.4
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', username: 'alice', email: 'alice@a.example' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', username: 'alice', email: 'alice@a.example' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        compositeKey,
      ]);

      expect(result).toEqual([
        {
          collection: 'users',
          field: 'username+email',
          value: JSON.stringify(['alice', 'alice@a.example']),
          archiveId: 'archive-user-1',
          existingId: 'existing-user-1',
        },
      ]);
    });

    test('does not flag a conflict when the per-field values differ but a delimiter concatenation would collide', () => {
      // Requirement 1.2: proves the composite value is built with JSON.stringify and not
      // by joining the fields with a delimiter -- 'a' + '|' + 'b|c' and 'a|b' + '|' + 'c'
      // are both 'a|b|c', yet these are two different pairs of values.
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', username: 'a', email: 'b|c' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', username: 'a|b', email: 'c' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        compositeKey,
      ]);

      expect(result).toEqual([]);
    });

    test('does not flag a conflict when every field of the key matches under the same _id', () => {
      // Requirement 1.5
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'same-id', username: 'alice', email: 'alice@a.example' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'same-id', username: 'alice', email: 'alice@a.example' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        compositeKey,
      ]);

      expect(result).toEqual([]);
    });

    test('does not match a document for a key whose fields are not all filled in', () => {
      // The sparse-field exclusion generalised to a composite key: a document missing any
      // field of the key holds no value on that key, so it cannot violate the index.
      const archiveDocs: UserUniqueFields[] = [
        { _id: 'archive-user-1', username: 'alice' },
      ];
      const existingDocs: UserUniqueFields[] = [
        { _id: 'existing-user-1', username: 'alice' },
      ];

      const result = collectConflicts('users', archiveDocs, existingDocs, [
        compositeKey,
      ]);

      expect(result).toEqual([]);
    });
  });
});

describe('findExistingCandidates', () => {
  // A composite-key collection shaped like `externalaccounts`: `providerType` takes only a
  // handful of values, so it must never be queried on its own.
  interface ExternalAccountLike {
    _id: string;
    providerType?: string | null;
    accountId?: string | null;
  }

  const pickExternalAccountLike = (
    doc: Record<string, unknown>,
  ): ExternalAccountLike => ({
    _id: String(doc._id),
    providerType:
      typeof doc.providerType === 'string' ? doc.providerType : undefined,
    accountId: typeof doc.accountId === 'string' ? doc.accountId : undefined,
  });

  const pickUserLike = (doc: Record<string, unknown>): UserUniqueFields => ({
    _id: String(doc._id),
    username: typeof doc.username === 'string' ? doc.username : undefined,
    email: typeof doc.email === 'string' ? doc.email : undefined,
    slackMemberId:
      typeof doc.slackMemberId === 'string' ? doc.slackMemberId : undefined,
  });

  const providerAccountKey = {
    label: 'providerType+accountId',
    fields: ['providerType', 'accountId'],
  } as const;

  test('queries a composite key by exact-match tuples, never by the low-cardinality field alone', async () => {
    // Requirement 1.1: the fetched candidate set has to be proportional to the tuples the
    // archive actually uses. A `$in` on `providerType` alone would match nearly the whole
    // destination collection.
    const lookup = vi.fn().mockResolvedValue([]);
    const archiveDocs: ExternalAccountLike[] = [
      { _id: 'a1', providerType: 'saml', accountId: 'x' },
      { _id: 'a2', providerType: 'saml', accountId: 'y' },
      { _id: 'a3', providerType: 'ldap', accountId: 'x' },
      // A repeat of the first tuple: the query must carry it only once.
      { _id: 'a4', providerType: 'saml', accountId: 'x' },
    ];

    await findExistingCandidates({
      lookup,
      archiveDocs,
      keys: [providerAccountKey],
      pick: pickExternalAccountLike,
    });

    expect(lookup).toHaveBeenCalledTimes(1);

    const [filter, projection] = lookup.mock.calls[0];
    // `$or` is the only top-level condition: nothing narrows on a single field, whatever
    // order the tuples happen to come in.
    expect(Object.keys(filter)).toEqual(['$or']);
    expect(filter.$or).toEqual([
      { providerType: 'saml', accountId: 'x' },
      { providerType: 'saml', accountId: 'y' },
      { providerType: 'ldap', accountId: 'x' },
    ]);
    expect(projection).toBe('_id providerType accountId');
  });

  test('batches the tuples of a composite key so that one query never asks for all of them', async () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const archiveDocs: ExternalAccountLike[] = Array.from(
      { length: 1500 },
      (_unused, i) => ({
        _id: `a${i}`,
        providerType: 'saml',
        accountId: `account-${i}`,
      }),
    );

    await findExistingCandidates({
      lookup,
      archiveDocs,
      keys: [providerAccountKey],
      pick: pickExternalAccountLike,
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls[0][0].$or).toHaveLength(1000);
    expect(lookup.mock.calls[1][0].$or).toHaveLength(500);
  });

  test('does not query at all when no archive document fills every field of a composite key', async () => {
    // The sparse-field exclusion: such documents hold no value on the key, so there is
    // nothing to look for. An empty `$or` would also be rejected by MongoDB itself.
    const lookup = vi.fn().mockResolvedValue([]);
    const archiveDocs: ExternalAccountLike[] = [
      { _id: 'a1', providerType: 'saml' },
      { _id: 'a2', accountId: 'x' },
      { _id: 'a3', providerType: 'ldap', accountId: '' },
    ];

    await findExistingCandidates({
      lookup,
      archiveDocs,
      keys: [providerAccountKey],
      pick: pickExternalAccountLike,
    });

    expect(lookup).not.toHaveBeenCalled();
  });

  test('keeps querying a single-field key with $in', async () => {
    const lookup = vi.fn().mockResolvedValue([]);
    const archiveDocs: UserUniqueFields[] = [
      { _id: 'a1', username: 'alice', email: 'alice@example.com' },
      { _id: 'a2', username: 'bob' },
    ];

    await findExistingCandidates({
      lookup,
      archiveDocs,
      keys: [
        { label: 'username', fields: ['username'] },
        { label: 'email', fields: ['email'] },
      ],
      pick: pickUserLike,
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls[0][0]).toEqual({
      username: { $in: ['alice', 'bob'] },
    });
    expect(lookup.mock.calls[1][0]).toEqual({
      email: { $in: ['alice@example.com'] },
    });
    // Every field of every key is projected, each of them once.
    expect(lookup.mock.calls[0][1]).toBe('_id username email');
  });

  test('returns each matched existing document once even when several keys match it', async () => {
    const existingRawDoc = {
      _id: 'existing-1',
      username: 'alice',
      email: 'alice@example.com',
    };
    const lookup = vi.fn().mockResolvedValue([existingRawDoc]);

    const result = await findExistingCandidates({
      lookup,
      archiveDocs: [
        { _id: 'a1', username: 'alice', email: 'alice@example.com' },
      ] satisfies UserUniqueFields[],
      keys: [
        { label: 'username', fields: ['username'] },
        { label: 'email', fields: ['email'] },
      ],
      pick: pickUserLike,
    });

    expect(result).toEqual([
      {
        _id: 'existing-1',
        username: 'alice',
        email: 'alice@example.com',
        slackMemberId: undefined,
      },
    ]);
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
  test('returns false when the map has no entries', () => {
    const report: UniqueConflictReport = {
      conflictsByCollection: new Map(),
    };

    expect(hasConflicts(report)).toBe(false);
  });

  test('returns false when every collection in the map has an empty conflict array', () => {
    const report: UniqueConflictReport = {
      conflictsByCollection: new Map([
        ['users', []],
        ['usergroups', []],
      ]),
    };

    expect(hasConflicts(report)).toBe(false);
  });

  test('returns true when one collection has at least one conflict entry', () => {
    const report: UniqueConflictReport = {
      conflictsByCollection: new Map([
        [
          'users',
          [
            {
              collection: 'users',
              field: 'username',
              value: 'alice',
              archiveId: 'archive-user-1',
              existingId: 'existing-user-1',
            },
          ],
        ],
        ['usergroups', []],
      ]),
    };

    expect(hasConflicts(report)).toBe(true);
  });

  test('returns true when a later collection in the map has a conflict entry', () => {
    const report: UniqueConflictReport = {
      conflictsByCollection: new Map([
        ['users', []],
        [
          'usergroups',
          [
            {
              collection: 'usergroups',
              field: 'name',
              value: 'Engineering',
              archiveId: 'archive-group-1',
              existingId: 'existing-group-1',
            },
          ],
        ],
      ]),
    };

    expect(hasConflicts(report)).toBe(true);
  });
});
