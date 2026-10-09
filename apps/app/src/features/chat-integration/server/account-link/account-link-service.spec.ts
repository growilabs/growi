// Proves task 6.1's core behavioral contract for the ChatAccountLink
// boundary: an approval screen can read what it's about to approve, and
// approving a live token links exactly once -- a second attempt (replay, or
// a race that lost) is refused, an expired token is refused, and a
// collision with someone else's link is reported distinctly (Requirement
// 7.4) rather than as a generic error.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatRelation } from '../models/chat-relation';
import {
  approveAccountLink,
  getAccountLinkOrderForApproval,
} from './account-link-service';
import { ChatAccountLink } from './models/chat-account-link';
import { ChatAccountLinkOrder } from './models/chat-account-link-order';

const RELATION_ID = 'relation-under-test';

const approvingUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'approving-user',
} as IUserHasId;

const otherUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'other-user',
} as IUserHasId;

const seedRelation = () =>
  ChatRelation.create({
    relationId: RELATION_ID,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: 'workspace-0001',
    workspaceName: 'Test Workspace',
    label: 'Our Slack',
    state: 'active',
    settingsVersion: 0,
    createdAt: new Date(),
  });

const seedLiveOrder = (
  overrides: Partial<{
    token: string;
    accountId: string;
    expiredAt: Date;
    isRevoked: boolean;
  }> = {},
) =>
  ChatAccountLinkOrder.create({
    token: overrides.token ?? 'token-under-test',
    relationId: RELATION_ID,
    platform: 'slack',
    accountId: overrides.accountId ?? 'U-actor',
    isRevoked: overrides.isRevoked ?? false,
    createdAt: new Date(),
    expiredAt: overrides.expiredAt ?? new Date(Date.now() + 10 * 60_000),
  });

describe('account-link-service', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_account_link_service',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatAccountLinkOrder.deleteMany({});
    await ChatAccountLink.deleteMany({});
    await ChatRelation.deleteMany({});
  });

  describe('getAccountLinkOrderForApproval', () => {
    it("returns 'not-found' when no order matches the token", async () => {
      const result = await getAccountLinkOrderForApproval(
        'no-such-token',
        approvingUser,
      );
      expect(result.status).toBe('not-found');
    });

    it("returns 'not-found' for a revoked order", async () => {
      await seedRelation();
      await seedLiveOrder({ token: 'revoked-token', isRevoked: true });

      const result = await getAccountLinkOrderForApproval(
        'revoked-token',
        approvingUser,
      );
      expect(result.status).toBe('not-found');
    });

    it("returns 'not-found' for an expired order", async () => {
      await seedRelation();
      await seedLiveOrder({
        token: 'expired-token',
        expiredAt: new Date(Date.now() - 1000),
      });

      const result = await getAccountLinkOrderForApproval(
        'expired-token',
        approvingUser,
      );
      expect(result.status).toBe('not-found');
    });

    it('shows which chat account and which GROWI user are about to be linked, including the workspace', async () => {
      await seedRelation();
      await seedLiveOrder({
        token: 'live-token',
        accountId: 'U-alice',
      });

      const result = await getAccountLinkOrderForApproval(
        'live-token',
        approvingUser,
      );

      expect(result.status).toBe('found');
      if (result.status !== 'found') {
        throw new Error('unreachable');
      }
      expect(result.display).toMatchObject({
        platform: 'slack',
        accountId: 'U-alice',
        workspaceName: 'Test Workspace',
        relationLabel: 'Our Slack',
        growiUsername: approvingUser.username,
      });
    });
  });

  describe('approveAccountLink', () => {
    it('links the chat account to the approving user and revokes the token, in one call', async () => {
      await seedRelation();
      await seedLiveOrder({ token: 'live-token', accountId: 'U-alice' });

      const result = await approveAccountLink('live-token', approvingUser);

      expect(result.status).toBe('linked');

      const link = await ChatAccountLink.findOne({
        relationId: RELATION_ID,
        platform: 'slack',
        accountId: 'U-alice',
      });
      expect(link).not.toBeNull();
      expect(link?.userId.toString()).toBe(approvingUser._id.toString());

      const order = await ChatAccountLinkOrder.findOne({
        token: 'live-token',
      });
      expect(order?.isRevoked).toBe(true);
    });

    it('refuses a second approval of the same (now-revoked) token -- no second link is created', async () => {
      await seedRelation();
      await seedLiveOrder({ token: 'live-token', accountId: 'U-alice' });

      const first = await approveAccountLink('live-token', approvingUser);
      const second = await approveAccountLink('live-token', otherUser);

      expect(first.status).toBe('linked');
      expect(second.status).toBe('invalid-or-expired');
      expect(
        await ChatAccountLink.countDocuments({
          relationId: RELATION_ID,
          platform: 'slack',
          accountId: 'U-alice',
        }),
      ).toBe(1);
    });

    it('refuses an expired token', async () => {
      await seedRelation();
      await seedLiveOrder({
        token: 'expired-token',
        accountId: 'U-alice',
        expiredAt: new Date(Date.now() - 1000),
      });

      const result = await approveAccountLink('expired-token', approvingUser);

      expect(result.status).toBe('invalid-or-expired');
      expect(await ChatAccountLink.countDocuments({})).toBe(0);
    });

    it("reports 'taken-by-another-user' when the chat account is already linked to someone else, and still consumes the token", async () => {
      await seedRelation();
      await seedLiveOrder({ token: 'live-token', accountId: 'U-alice' });
      await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: otherUser._id,
        platform: 'slack',
        accountId: 'U-alice',
        linkedAt: new Date(),
      });

      const result = await approveAccountLink('live-token', approvingUser);

      expect(result.status).toBe('taken-by-another-user');
      // The pre-existing link is untouched -- still points at otherUser.
      const link = await ChatAccountLink.findOne({
        relationId: RELATION_ID,
        platform: 'slack',
        accountId: 'U-alice',
      });
      expect(link?.userId.toString()).toBe(otherUser._id.toString());
      expect(
        await ChatAccountLink.countDocuments({
          relationId: RELATION_ID,
          platform: 'slack',
          accountId: 'U-alice',
        }),
      ).toBe(1);

      // The token must not be reusable after this outcome either.
      const order = await ChatAccountLinkOrder.findOne({
        token: 'live-token',
      });
      expect(order?.isRevoked).toBe(true);

      const retry = await approveAccountLink('live-token', approvingUser);
      expect(retry.status).toBe('invalid-or-expired');
    });
  });
});
