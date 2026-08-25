import type { HasObjectId, IUserHasId } from '@growi/core';
import { Types } from 'mongoose';

import type { IAccessToken } from '~/server/models/access-token';
import { UserStatus } from '~/server/models/user/conts';

import {
  type ArchiveUserIdentity,
  USER_UNIQUE_KEYS,
} from './detect-unique-conflicts';
import { planAdminRescue } from './rescue-admins';

const DEST_ADMIN_ID = '0123456789abcdef01230001';
const OTHER_ADMIN_ID = '0123456789abcdef01230002';
const OTHER_USER_ID = '0123456789abcdef01230003';
const PASSWORD_HASH = 'destination-password-hash';
const TOKEN_HASH = 'destination-token-hash';

/*
 * The fixtures below are plain data records, not collaborators, so they are written out
 * in full rather than built with `mock<T>()`: every required field is spelled out (so the
 * fixture type-checks without an assertion) and the fields under test - the password
 * hash, the admin flag - keep readable values that auto-stubs would hide.
 */
const buildAdmin = (overrides: Partial<IUserHasId> = {}): IUserHasId => ({
  _id: DEST_ADMIN_ID,
  name: 'Destination Admin',
  username: 'dest-admin',
  email: 'dest-admin@example.com',
  password: PASSWORD_HASH,
  imageUrlCached: '/images/icons/user.svg',
  isGravatarEnabled: false,
  admin: true,
  readOnly: false,
  apiToken: 'destination-api-token',
  isEmailPublished: true,
  isInvitationEmailSended: false,
  lang: 'en_US',
  slackMemberId: 'UDEST0001',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  introduction: '',
  status: UserStatus.STATUS_ACTIVE,
  ...overrides,
});

const buildAccessToken = (
  overrides: Partial<IAccessToken & HasObjectId> = {},
): IAccessToken & HasObjectId => ({
  _id: '0123456789abcdef01230101',
  user: DEST_ADMIN_ID,
  tokenHash: TOKEN_HASH,
  expiredAt: new Date('2030-01-01T00:00:00.000Z'),
  scopes: [],
  description: 'destination token',
  ...overrides,
});

const buildArchiveIdentity = (
  overrides: Partial<ArchiveUserIdentity> = {},
): ArchiveUserIdentity => ({
  usernames: new Set<string>(),
  emails: new Set<string>(),
  slackMemberIds: new Set<string>(),
  ids: new Set<string>(),
  ...overrides,
});

describe('planAdminRescue', () => {
  describe('when nothing of the admin collides with the source archive', () => {
    test('rescues the document as it stands, keeping its _id, username, email, slackMemberId, password hash and admin flag', () => {
      // Requirements 4.1, 4.2, 4.3, 4.7: the rescued account is the destination document
      // itself - nothing removed, and nothing (least of all a source group relation)
      // grafted onto it.
      const admin = buildAdmin();
      const archiveIdentity = buildArchiveIdentity({
        usernames: new Set(['someone-else']),
        emails: new Set(['someone-else@example.com']),
        ids: new Set([OTHER_USER_ID]),
      });

      const plan = planAdminRescue([admin], [], archiveIdentity);

      expect(plan.rescued).toHaveLength(1);
      const [rescued] = plan.rescued;
      expect(rescued.user).toEqual(admin);
      expect(rescued.originalUsername).toBe('dest-admin');
      expect(rescued.rescuedUsername).toBe('dest-admin');
      expect(rescued.emailRemoved).toBe(false);
      expect(rescued.slackMemberIdRemoved).toBe(false);
      expect(rescued.idReassigned).toBe(false);
    });
  });

  describe('when the username collides with the source archive', () => {
    test('rescues under a username the archive does not hold, and reports both names', () => {
      // Requirement 4.4
      const admin = buildAdmin({ username: 'admin' });
      const archiveIdentity = buildArchiveIdentity({
        // The obvious replacement is taken as well, so a single fixed suffix is not enough.
        usernames: new Set(['admin', 'admin-rescued']),
      });

      const [rescued] = planAdminRescue([admin], [], archiveIdentity).rescued;

      expect(rescued.originalUsername).toBe('admin');
      expect(rescued.rescuedUsername).not.toBe('admin');
      expect(archiveIdentity.usernames.has(rescued.rescuedUsername)).toBe(
        false,
      );
      expect(rescued.user.username).toBe(rescued.rescuedUsername);

      // Requirement 4.2: the rename must not cost the credentials or the privilege.
      expect(rescued.user.password).toBe(PASSWORD_HASH);
      expect(rescued.user.admin).toBe(true);
      expect(rescued.user._id).toBe(DEST_ADMIN_ID);
      expect(rescued.user.email).toBe('dest-admin@example.com');
      expect(rescued.emailRemoved).toBe(false);
      expect(rescued.idReassigned).toBe(false);
    });

    test('gives two admins that both need a rename two different usernames', () => {
      // Requirement 4.4: the rescued documents are re-inserted into the same unique index,
      // so they must not collide with each other either - including with a destination
      // admin that keeps its own name.
      const colliding = buildAdmin({ username: 'admin' });
      const keepsOwnName = buildAdmin({
        _id: OTHER_ADMIN_ID,
        username: 'admin-rescued',
        email: 'other-admin@example.com',
        slackMemberId: 'UDEST0002',
      });
      const archiveIdentity = buildArchiveIdentity({
        usernames: new Set(['admin']),
      });

      const plan = planAdminRescue(
        [colliding, keepsOwnName],
        [],
        archiveIdentity,
      );

      const usernames = plan.rescued.map((rescued) => rescued.user.username);
      expect(usernames).toContain('admin-rescued');
      expect(new Set(usernames).size).toBe(2);
    });
  });

  describe('when a sparse unique field collides with the source archive', () => {
    test('rescues without the email, leaving the rest of the document alone', () => {
      // Requirement 4.5
      const admin = buildAdmin();
      const archiveIdentity = buildArchiveIdentity({
        emails: new Set(['dest-admin@example.com']),
      });

      const [rescued] = planAdminRescue([admin], [], archiveIdentity).rescued;

      expect(rescued.emailRemoved).toBe(true);
      expect('email' in rescued.user).toBe(false);
      expect(rescued.user.username).toBe('dest-admin');
      expect(rescued.user.slackMemberId).toBe('UDEST0001');
      expect(rescued.slackMemberIdRemoved).toBe(false);
      expect(rescued.user.password).toBe(PASSWORD_HASH);
      expect(rescued.user.admin).toBe(true);
    });

    test('rescues without the slackMemberId, leaving the rest of the document alone', () => {
      // Requirement 4.5 applied to the third unique index (models/user: slackMemberId is
      // unique + sparse). Dropping it would make the re-insertion fail wherever both
      // instances face the same Slack workspace, and requirement 4.1 with it.
      const admin = buildAdmin();
      const archiveIdentity = buildArchiveIdentity({
        slackMemberIds: new Set(['UDEST0001']),
      });

      const [rescued] = planAdminRescue([admin], [], archiveIdentity).rescued;

      expect(rescued.slackMemberIdRemoved).toBe(true);
      expect('slackMemberId' in rescued.user).toBe(false);
      expect(rescued.user.username).toBe('dest-admin');
      expect(rescued.user.email).toBe('dest-admin@example.com');
      expect(rescued.emailRemoved).toBe(false);
      expect(rescued.user.password).toBe(PASSWORD_HASH);
    });

    test('resolves a collision on every unique field the detection declares', () => {
      // USER_UNIQUE_KEYS is the single source for which fields of `users` are unique.
      // A field added there without a rescue rule must fail here rather than be
      // re-inserted with a value the source archive already holds.
      const admin = buildAdmin();
      const archiveIdentity = buildArchiveIdentity({
        usernames: new Set(['dest-admin']),
        emails: new Set(['dest-admin@example.com']),
        slackMemberIds: new Set(['UDEST0001']),
      });

      const [rescued] = planAdminRescue([admin], [], archiveIdentity).rescued;

      const userUniqueFields = USER_UNIQUE_KEYS.flatMap((key) => key.fields);
      for (const field of userUniqueFields) {
        expect(rescued.user[field]).not.toBe(admin[field]);
      }
    });
  });

  describe('when the _id collides with the source archive', () => {
    test('rescues under a newly assigned _id and flags the reassignment', () => {
      // Requirement 4.10: sessions established before the transfer are keyed by the old
      // _id, so the operator has to be told they are gone.
      const admin = buildAdmin();
      const archiveIdentity = buildArchiveIdentity({
        ids: new Set([DEST_ADMIN_ID]),
      });

      const [rescued] = planAdminRescue([admin], [], archiveIdentity).rescued;

      expect(rescued.idReassigned).toBe(true);
      expect(rescued.user._id).not.toBe(DEST_ADMIN_ID);
      expect(archiveIdentity.ids.has(rescued.user._id)).toBe(false);
      expect(Types.ObjectId.isValid(rescued.user._id)).toBe(true);
      expect(rescued.user.password).toBe(PASSWORD_HASH);
      expect(rescued.user.admin).toBe(true);
    });

    test('detects the collision when the destination _id is an ObjectId rather than a hex string', () => {
      // Requirement 4.10: a `lean()` read hands back an ObjectId even though IUserHasId
      // declares `_id: string`, while the archive side holds hex strings. Comparing the
      // two without normalising means the collision is never seen and 4.10 never fires.
      const admin = buildAdmin({
        // Reproducing that declared-type / runtime-value mismatch is the point of this
        // test, so the fixture has to state it.
        _id: new Types.ObjectId(DEST_ADMIN_ID) as unknown as string,
      });
      const archiveIdentity = buildArchiveIdentity({
        ids: new Set([DEST_ADMIN_ID]),
      });

      const [rescued] = planAdminRescue([admin], [], archiveIdentity).rescued;

      expect(rescued.idReassigned).toBe(true);
      expect(String(rescued.user._id)).not.toBe(DEST_ADMIN_ID);
    });
  });

  describe('access tokens', () => {
    test('carries only the tokens the rescued admin issued, with their hashes intact', () => {
      // Requirement 4.9
      const admin = buildAdmin();
      const ownToken = buildAccessToken({ _id: '0123456789abcdef01230111' });
      const anotherUsersToken = buildAccessToken({
        _id: '0123456789abcdef01230112',
        user: OTHER_USER_ID,
        tokenHash: 'another-users-token-hash',
      });

      const [rescued] = planAdminRescue(
        [admin],
        [ownToken, anotherUsersToken],
        buildArchiveIdentity(),
      ).rescued;

      expect(rescued.accessTokens).toHaveLength(1);
      expect(rescued.accessTokens[0]._id).toBe('0123456789abcdef01230111');
      expect(rescued.accessTokens[0].tokenHash).toBe(TOKEN_HASH);
      expect(String(rescued.accessTokens[0].user)).toBe(DEST_ADMIN_ID);
    });

    test('re-points the tokens at the new _id when the admin is reassigned one', () => {
      // Requirements 4.9, 4.10: a token left pointing at the old _id resolves to nobody.
      const admin = buildAdmin();
      const ownToken = buildAccessToken();
      const archiveIdentity = buildArchiveIdentity({
        ids: new Set([DEST_ADMIN_ID]),
      });

      const [rescued] = planAdminRescue(
        [admin],
        [ownToken],
        archiveIdentity,
      ).rescued;

      expect(rescued.idReassigned).toBe(true);
      expect(rescued.accessTokens).toHaveLength(1);
      expect(rescued.accessTokens[0].user).toBe(rescued.user._id);
      expect(rescued.accessTokens[0].tokenHash).toBe(TOKEN_HASH);
    });

    test('matches a token whose user reference is an ObjectId, as a lean() read hands it back', () => {
      // Requirement 4.9: both sides come out of MongoDB as ObjectIds, so comparing them
      // unnormalised drops every token and the rescued admin loses all of them silently.
      const admin = buildAdmin({
        _id: new Types.ObjectId(DEST_ADMIN_ID) as unknown as string,
      });
      const ownToken = buildAccessToken({
        user: new Types.ObjectId(DEST_ADMIN_ID),
      });

      const [rescued] = planAdminRescue(
        [admin],
        [ownToken],
        buildArchiveIdentity(),
      ).rescued;

      expect(rescued.accessTokens).toHaveLength(1);
      expect(rescued.accessTokens[0].tokenHash).toBe(TOKEN_HASH);
    });
  });

  describe('who is eligible', () => {
    test.each([
      ['suspended', { status: UserStatus.STATUS_SUSPENDED }],
      ['still only registered', { status: UserStatus.STATUS_REGISTERED }],
      ['deleted', { status: UserStatus.STATUS_DELETED }],
      ['without a password', { password: '' }],
    ])('does not rescue an admin %s', (_label, overrides) => {
      // Requirement 4.1 (and the evidence behind the 3.5 warning): rescuing an account
      // that cannot pass loginRequiredStrictly leaves nobody able to log in. Whether the
      // destination has any loginable administrator at all is reported separately, via
      // `isLoginable` + `loginableAdminCount` (`g2g-transfer.ts`'s `answerGROWIInfo`), not
      // through this plan.
      const admin = buildAdmin({ username: 'stale-admin', ...overrides });

      const plan = planAdminRescue([admin], [], buildArchiveIdentity());

      expect(plan.rescued).toEqual([]);
    });

    test('ignores a user that is not an admin at all', () => {
      // Requirement 4.1: the rescue is about administrators; an ordinary member is
      // never rescued.
      const member = buildAdmin({ username: 'member', admin: false });

      const plan = planAdminRescue([member], [], buildArchiveIdentity());

      expect(plan.rescued).toEqual([]);
    });

    test('rescues the loginable admin, leaving out the one that cannot log in', () => {
      // Requirement 4.1
      const loginable = buildAdmin({ username: 'loginable-admin' });
      const passwordless = buildAdmin({
        _id: OTHER_ADMIN_ID,
        username: 'sso-only-admin',
        email: 'sso-only-admin@example.com',
        slackMemberId: 'UDEST0002',
        password: '',
      });

      const plan = planAdminRescue(
        [loginable, passwordless],
        [],
        buildArchiveIdentity(),
      );

      expect(plan.rescued.map((rescued) => rescued.user.username)).toEqual([
        'loginable-admin',
      ]);
    });
  });

  test('does not modify the documents it was handed', () => {
    const admin = buildAdmin();
    const token = buildAccessToken();
    const archiveIdentity = buildArchiveIdentity({
      usernames: new Set(['dest-admin']),
      emails: new Set(['dest-admin@example.com']),
      slackMemberIds: new Set(['UDEST0001']),
      ids: new Set([DEST_ADMIN_ID]),
    });

    planAdminRescue([admin], [token], archiveIdentity);

    expect(admin).toEqual(buildAdmin());
    expect(token).toEqual(buildAccessToken());
  });
});
