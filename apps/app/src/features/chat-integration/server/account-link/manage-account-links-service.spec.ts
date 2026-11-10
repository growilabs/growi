// Proves task 6.2's core behavioral contract for the ChatAccountLink
// boundary (Requirements 7.5, 7.7): a user can see only their OWN linked
// chat accounts, can unlink one of their own, cannot unlink someone else's
// by guessing its id, and -- the task's own completion condition -- a
// subsequent write attempt through the SAME (relationId, platform,
// accountId) is refused via `resolveActor` (task 3.3, unmodified) once the
// link row is gone.

import type { ChatAccountRef } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';

import { resolveActor } from '../command/resolve-actor';
import { ChatRelation } from '../models/chat-relation';
import {
  listAccountLinksForUser,
  unlinkAccountLink,
} from './manage-account-links-service';
import { ChatAccountLink } from './models/chat-account-link';

const RELATION_ID = 'relation-under-test';
const OTHER_RELATION_ID = 'relation-other';

// biome-ignore lint/suspicious/noExplicitAny: no document type is exported for the crowi-wired User model.
const getUserModel = (): any => mongoose.model('User');

let seq = 0;
const createUser = (attrs: { status?: number } = {}) => {
  seq += 1;
  return getUserModel().create({
    name: `user ${seq}`,
    username: `user-${seq}`,
    email: `user-${seq}@example.com`,
    status: attrs.status ?? UserStatus.STATUS_ACTIVE,
  });
};

const seedRelation = (
  relationId: string,
  overrides: Partial<{ workspaceName: string; label: string | null }> = {},
) =>
  ChatRelation.create({
    relationId,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: `workspace-${relationId}`,
    workspaceName: overrides.workspaceName ?? 'Test Workspace',
    label: overrides.label ?? null,
    state: 'active',
    settingsVersion: 0,
    createdAt: new Date(),
  });

const createLink = (
  userId: mongoose.Types.ObjectId,
  overrides: Partial<{ relationId: string; accountId: string }> = {},
) =>
  ChatAccountLink.create({
    relationId: overrides.relationId ?? RELATION_ID,
    userId,
    platform: 'slack',
    accountId: overrides.accountId ?? 'U-alice',
    linkedAt: new Date(),
  });

describe('manage-account-links-service', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_manage_account_links',
    ));
    userModelFactory(null);
  });

  beforeEach(async () => {
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      ChatRelation.deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('listAccountLinksForUser', () => {
    it("returns only the CURRENT user's links, never another user's (Requirement 7.7)", async () => {
      await seedRelation(RELATION_ID);
      const me = await createUser();
      const someoneElse = await createUser();
      await createLink(me._id, { accountId: 'U-mine' });
      await createLink(someoneElse._id, { accountId: 'U-not-mine' });

      const result = await listAccountLinksForUser(me._id);

      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('U-mine');
    });

    it('joins chat_relations for display info (workspace name and label)', async () => {
      await seedRelation(RELATION_ID, {
        workspaceName: 'Acme Workspace',
        label: 'Our Slack',
      });
      const me = await createUser();
      await createLink(me._id);

      const result = await listAccountLinksForUser(me._id);

      expect(result[0]).toMatchObject({
        platform: 'slack',
        accountId: 'U-alice',
        workspaceName: 'Acme Workspace',
        relationLabel: 'Our Slack',
      });
    });

    it('returns an empty list when the user has no links', async () => {
      const me = await createUser();

      const result = await listAccountLinksForUser(me._id);

      expect(result).toEqual([]);
    });

    it('lists links to more than one relation for the same user (Requirement 7.1)', async () => {
      await seedRelation(RELATION_ID, { workspaceName: 'Workspace A' });
      await seedRelation(OTHER_RELATION_ID, { workspaceName: 'Workspace B' });
      const me = await createUser();
      await createLink(me._id, { relationId: RELATION_ID, accountId: 'U-a' });
      await createLink(me._id, {
        relationId: OTHER_RELATION_ID,
        accountId: 'U-b',
      });

      const result = await listAccountLinksForUser(me._id);

      expect(result.map((r) => r.workspaceName).sort()).toEqual([
        'Workspace A',
        'Workspace B',
      ]);
    });
  });

  describe('unlinkAccountLink', () => {
    it('deletes the row and reports unlinked', async () => {
      await seedRelation(RELATION_ID);
      const me = await createUser();
      const link = await createLink(me._id);

      const result = await unlinkAccountLink(me._id, link._id.toString());

      expect(result).toBe('unlinked');
      expect(await ChatAccountLink.findById(link._id)).toBeNull();
    });

    it("refuses to delete ANOTHER user's link row, even with a valid id (Requirement 7.5)", async () => {
      await seedRelation(RELATION_ID);
      const me = await createUser();
      const someoneElse = await createUser();
      const othersLink = await createLink(someoneElse._id);

      const result = await unlinkAccountLink(me._id, othersLink._id.toString());

      expect(result).toBe('not-found');
      // Not silently succeeding means the row must still exist.
      expect(await ChatAccountLink.findById(othersLink._id)).not.toBeNull();
    });

    it('reports not-found for an id that does not exist', async () => {
      const me = await createUser();

      const result = await unlinkAccountLink(
        me._id,
        new Types.ObjectId().toString(),
      );

      expect(result).toBe('not-found');
    });

    it('reports not-found (not a thrown CastError) for a malformed id', async () => {
      const me = await createUser();

      await expect(unlinkAccountLink(me._id, 'not-an-object-id')).resolves.toBe(
        'not-found',
      );
    });

    it("does NOT delete the user's other links", async () => {
      await seedRelation(RELATION_ID);
      const me = await createUser();
      const linkToDelete = await createLink(me._id, { accountId: 'U-a' });
      const linkToKeep = await createLink(me._id, { accountId: 'U-b' });

      await unlinkAccountLink(me._id, linkToDelete._id.toString());

      expect(await ChatAccountLink.findById(linkToKeep._id)).not.toBeNull();
    });
  });

  describe('end-to-end with resolveActor (the task completion condition)', () => {
    const actorRef: ChatAccountRef = {
      platform: 'slack',
      accountId: 'U-alice',
      displayName: 'Alice',
    };

    it('lets resolveActor resolve the user before unlinking, and refuses as not-linked after (Requirements 7.5, 7.6)', async () => {
      await seedRelation(RELATION_ID);
      const me = await createUser();
      const link = await createLink(me._id, { accountId: 'U-alice' });

      const before = await resolveActor(RELATION_ID, actorRef);
      expect(before.user?._id.toString()).toBe(me._id.toString());
      expect(before.writeDenied).toBeNull();

      const unlinkResult = await unlinkAccountLink(me._id, link._id.toString());
      expect(unlinkResult).toBe('unlinked');

      const after = await resolveActor(RELATION_ID, actorRef);
      expect(after.user).toBeNull();
      expect(after.writeDenied).toBe('not-linked');
    });
  });

  describe('inactive GROWI users (a "do not break this" constraint, not new behavior)', () => {
    it('leaves the link row intact when the linked user is inactive -- nothing in this module deletes based on user status', async () => {
      await seedRelation(RELATION_ID);
      const inactiveUser = await createUser({
        status: UserStatus.STATUS_DELETED,
      });
      const link = await createLink(inactiveUser._id);

      // Neither listAccountLinksForUser nor unlinkAccountLink was called --
      // simply confirming the row survives an inactive user with no
      // intervention from this task's code.
      expect(await ChatAccountLink.findById(link._id)).not.toBeNull();

      // And resolveActor treats it as inactive (not not-linked), per task
      // 3.3's already-committed behavior -- confirming the row's continued
      // presence is what makes that distinction possible.
      const resolved = await resolveActor(RELATION_ID, {
        platform: 'slack',
        accountId: link.accountId,
        displayName: 'Anyone',
      });
      expect(resolved.user).toBeNull();
      expect(resolved.writeDenied).toBe('inactive');
    });
  });
});
