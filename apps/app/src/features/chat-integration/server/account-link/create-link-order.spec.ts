import type { ChatAccountRef } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { findOrCreatePendingAccountLinkOrder } from './create-link-order';
import { ChatAccountLinkOrder } from './models/chat-account-link-order';

const RELATION_ID = 'relation-under-test';
const ACTOR: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U-actor',
  displayName: 'Actor',
};

describe('findOrCreatePendingAccountLinkOrder', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_create_link_order',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatAccountLinkOrder.deleteMany({});
  });

  it('creates a new pending order when none exists', async () => {
    const order = await findOrCreatePendingAccountLinkOrder(RELATION_ID, ACTOR);

    expect(order.relationId).toBe(RELATION_ID);
    expect(order.platform).toBe(ACTOR.platform);
    expect(order.accountId).toBe(ACTOR.accountId);
    expect(await ChatAccountLinkOrder.countDocuments({})).toBe(1);
  });

  it('reuses the same still-valid order on a second call, instead of creating another', async () => {
    const first = await findOrCreatePendingAccountLinkOrder(RELATION_ID, ACTOR);
    const second = await findOrCreatePendingAccountLinkOrder(
      RELATION_ID,
      ACTOR,
    );

    expect(second._id.toString()).toBe(first._id.toString());
    expect(second.token).toBe(first.token);
    expect(await ChatAccountLinkOrder.countDocuments({})).toBe(1);
  });

  it('does not reuse a revoked order -- issues a fresh one instead', async () => {
    const first = await findOrCreatePendingAccountLinkOrder(RELATION_ID, ACTOR);
    await ChatAccountLinkOrder.updateOne(
      { _id: first._id },
      { isRevoked: true },
    );

    const second = await findOrCreatePendingAccountLinkOrder(
      RELATION_ID,
      ACTOR,
    );

    expect(second._id.toString()).not.toBe(first._id.toString());
    expect(await ChatAccountLinkOrder.countDocuments({})).toBe(2);
  });

  it('does not reuse an expired order -- issues a fresh one instead', async () => {
    const first = await findOrCreatePendingAccountLinkOrder(RELATION_ID, ACTOR);
    await ChatAccountLinkOrder.updateOne(
      { _id: first._id },
      { expiredAt: new Date(Date.now() - 1000) },
    );

    const second = await findOrCreatePendingAccountLinkOrder(
      RELATION_ID,
      ACTOR,
    );

    expect(second._id.toString()).not.toBe(first._id.toString());
    expect(await ChatAccountLinkOrder.countDocuments({})).toBe(2);
  });

  it("does not reuse another relation or another chat account's pending order", async () => {
    await findOrCreatePendingAccountLinkOrder(RELATION_ID, ACTOR);

    const otherRelation = await findOrCreatePendingAccountLinkOrder(
      'another-relation',
      ACTOR,
    );
    const otherAccount = await findOrCreatePendingAccountLinkOrder(
      RELATION_ID,
      { ...ACTOR, accountId: 'U-someone-else' },
    );

    expect(await ChatAccountLinkOrder.countDocuments({})).toBe(3);
    expect(otherRelation.relationId).toBe('another-relation');
    expect(otherAccount.accountId).toBe('U-someone-else');
  });
});
