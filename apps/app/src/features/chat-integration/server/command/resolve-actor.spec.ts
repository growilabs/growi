import type { ChatAccountRef } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';
import UserGroupRelation from '~/server/models/user-group-relation';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { resolveActor, resolveReadDenial } from './resolve-actor';

const RELATION_ID = 'relation-1';

const actor: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U0ACCOUNT',
  displayName: 'Chatty Person',
};

let seq = 0;

// biome-ignore lint/suspicious/noExplicitAny: the User model is registered by
// a crowi-wired factory and has no exported document type.
const getUserModel = (): any => mongoose.model('User');

const createUser = async (
  attrs: { status?: number; readOnly?: boolean } = {},
) => {
  seq += 1;
  return getUserModel().create({
    name: `user ${seq}`,
    username: `user-${seq}`,
    email: `user-${seq}@example.com`,
    status: attrs.status ?? UserStatus.STATUS_ACTIVE,
    readOnly: attrs.readOnly ?? false,
  });
};

const link = async (
  userId: mongoose.Types.ObjectId,
  relationId = RELATION_ID,
) =>
  ChatAccountLink.create({
    relationId,
    userId,
    platform: actor.platform,
    accountId: actor.accountId,
    linkedAt: new Date(),
  });

describe('resolveActor', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_resolve_actor',
    ));
    // The User model is normally registered at boot by crowi; the factory
    // accepts a null crowi and only touches crowi from functions this spec
    // never calls.
    userModelFactory(null);
  });

  beforeEach(async () => {
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      UserGroupRelation.deleteMany({}),
      ExternalUserGroupRelation.deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('reports not-linked when no chat_account_links row exists (Requirement 7.6)', async () => {
    const resolved = await resolveActor(RELATION_ID, actor);

    expect(resolved.user).toBeNull();
    expect(resolved.userGroups).toEqual([]);
    expect(resolved.writeDenied).toBe('not-linked');
  });

  it('resolves the linked active user together with its internal AND external group memberships (Requirement 3.6)', async () => {
    const user = await createUser();
    await link(user._id);

    const internalGroupId = new mongoose.Types.ObjectId();
    const externalGroupId = new mongoose.Types.ObjectId();
    await UserGroupRelation.create({
      relatedGroup: internalGroupId,
      relatedUser: user._id,
    });
    await ExternalUserGroupRelation.create({
      relatedGroup: externalGroupId,
      relatedUser: user._id,
    });

    const resolved = await resolveActor(RELATION_ID, actor);

    expect(resolved.user?._id.toString()).toBe(user._id.toString());
    expect(resolved.user?.username).toBe(user.username);
    expect(resolved.writeDenied).toBeNull();
    expect(resolved.userGroups.map(String).sort()).toEqual(
      [internalGroupId.toString(), externalGroupId.toString()].sort(),
    );
  });

  // Requirement 4.4 / 7.6: each non-active status individually, because the
  // guidance an inactive person gets must never be "link your account".
  describe.each([
    ['承認待ち (STATUS_REGISTERED)', UserStatus.STATUS_REGISTERED],
    ['停止 (STATUS_SUSPENDED)', UserStatus.STATUS_SUSPENDED],
    ['削除扱い (STATUS_DELETED)', UserStatus.STATUS_DELETED],
    ['招待中 (STATUS_INVITED)', UserStatus.STATUS_INVITED],
  ])('when the linked GROWI user is %s', (_label, status) => {
    it('treats the actor as having no user, and denies writes as inactive -- not as not-linked', async () => {
      const user = await createUser({ status });
      await link(user._id);
      await UserGroupRelation.create({
        relatedGroup: new mongoose.Types.ObjectId(),
        relatedUser: user._id,
      });

      const resolved = await resolveActor(RELATION_ID, actor);

      expect(resolved.user).toBeNull();
      expect(resolved.userGroups).toEqual([]);
      expect(resolved.writeDenied).toBe('inactive');
    });
  });

  it('keeps a read-only user as the actor so searches run under their own permissions, and denies writes only (Requirement 4.5)', async () => {
    const user = await createUser({ readOnly: true });
    await link(user._id);
    const groupId = new mongoose.Types.ObjectId();
    await UserGroupRelation.create({
      relatedGroup: groupId,
      relatedUser: user._id,
    });

    const resolved = await resolveActor(RELATION_ID, actor);

    expect(resolved.user?._id.toString()).toBe(user._id.toString());
    expect(resolved.userGroups.map(String)).toEqual([groupId.toString()]);
    expect(resolved.writeDenied).toBe('read-only');
  });

  it('reports inactive rather than read-only when the user is both', async () => {
    const user = await createUser({
      status: UserStatus.STATUS_SUSPENDED,
      readOnly: true,
    });
    await link(user._id);

    const resolved = await resolveActor(RELATION_ID, actor);

    expect(resolved.user).toBeNull();
    expect(resolved.writeDenied).toBe('inactive');
  });

  it('reports inactive when the link row survives but its GROWI user document is gone', async () => {
    const user = await createUser();
    await link(user._id);
    await getUserModel().deleteOne({ _id: user._id });

    const resolved = await resolveActor(RELATION_ID, actor);

    expect(resolved.user).toBeNull();
    expect(resolved.writeDenied).toBe('inactive');
  });

  it('keys the lookup on relationId as well, so the same chat account is not resolved across relations (Requirement 7.4)', async () => {
    const user = await createUser();
    await link(user._id, 'relation-other');

    const resolvedHere = await resolveActor(RELATION_ID, actor);
    expect(resolvedHere.user).toBeNull();
    expect(resolvedHere.writeDenied).toBe('not-linked');

    const resolvedThere = await resolveActor('relation-other', actor);
    expect(resolvedThere.user?._id.toString()).toBe(user._id.toString());
  });
});

describe('resolveReadDenial', () => {
  const resolvedOf = (
    user: unknown,
    writeDenied: 'not-linked' | 'read-only' | 'inactive' | null,
    // biome-ignore lint/suspicious/noExplicitAny: only the two fields under test matter here.
  ): any => ({ user, userGroups: [], writeDenied });

  it('allows the read when a GROWI user was resolved, whatever the guest setting is', () => {
    expect(resolveReadDenial(resolvedOf({}, null), false)).toBeNull();
    expect(resolveReadDenial(resolvedOf({}, 'read-only'), false)).toBeNull();
  });

  it('allows an unlinked actor to read when guests may read (Requirement 3.7)', () => {
    expect(resolveReadDenial(resolvedOf(null, 'not-linked'), true)).toBeNull();
  });

  it('denies the read for an unlinked actor when this GROWI shows nothing to guests', () => {
    expect(resolveReadDenial(resolvedOf(null, 'not-linked'), false)).toBe(
      'not-linked',
    );
  });

  // The inactive person is already linked, so telling them to link would
  // send them round a loop that changes nothing.
  it('denies the read of an inactive user as inactive, never as not-linked', () => {
    expect(resolveReadDenial(resolvedOf(null, 'inactive'), false)).toBe(
      'inactive',
    );
  });
});
