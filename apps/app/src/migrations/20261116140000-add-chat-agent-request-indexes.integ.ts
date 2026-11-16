/**
 * Integration test for the indexes of `chat_agent_requests`: at most one
 * running request per GROWI user, one row per (relationId, requestId), and a
 * 24-hour expiry. The behaviour is checked through real duplicate-key errors,
 * not only through the index definitions.
 */
import type { Collection, Db, Document } from 'mongodb';
import mongoose from 'mongoose';

import { ChatAgentRequest } from '~/features/chat-integration/server/agent/models/chat-agent-request';

const PAIR_INDEX = 'relationId_1_requestId_1_unique';
const RUNNING_INDEX = 'userId_1_running_unique';
const TTL_INDEX = 'startedAt_1_ttl';
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

const describeIndex = ({
  name,
  key,
  expireAfterSeconds,
  partialFilterExpression,
  unique,
}: Document) => ({
  name,
  key,
  expireAfterSeconds,
  partialFilterExpression,
  unique,
});

const DUPLICATE_KEY = 11000;

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err as { code?: number; message: string };
  }
  return undefined;
};

describe('add-chat-agent-request-indexes', () => {
  let db: Db;
  let collection: Collection;
  let migrate: typeof import('./20261116140000-add-chat-agent-request-indexes');

  const indexes = async () =>
    (await collection.indexes())
      .map(describeIndex)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();

  const create = (overrides: Record<string, unknown>) =>
    ChatAgentRequest.create({
      relationId: 'relation-1',
      requestId: 'request-1',
      userId: userA,
      text: 'summarize this',
      conversationKey: 'slack:C1:1700000000.000100',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      auditContext: { requestArrivedAt: new Date() },
      ...overrides,
    });

  beforeAll(async () => {
    migrate = await import('./20261116140000-add-chat-agent-request-indexes');
    const connectedDb = mongoose.connection.db;
    if (connectedDb == null) {
      throw new Error('The test setup did not connect mongoose');
    }
    db = connectedDb;
    collection = db.collection('chat_agent_requests');
  });

  beforeEach(async () => {
    // The template database already ran this migration.
    await migrate.down(db);
    await collection.deleteMany({});
    await migrate.up(db);
  });

  afterAll(async () => {
    await collection.deleteMany({});
  });

  it('creates the three indexes under explicit names', async () => {
    const all = await indexes();
    expect(all.find((i) => i.name === PAIR_INDEX)).toEqual({
      name: PAIR_INDEX,
      key: { relationId: 1, requestId: 1 },
      unique: true,
      expireAfterSeconds: undefined,
      partialFilterExpression: undefined,
    });
    expect(all.find((i) => i.name === RUNNING_INDEX)).toEqual({
      name: RUNNING_INDEX,
      key: { userId: 1 },
      unique: true,
      expireAfterSeconds: undefined,
      partialFilterExpression: { state: 'running' },
    });
    expect(all.find((i) => i.name === TTL_INDEX)).toEqual({
      name: TTL_INDEX,
      key: { startedAt: 1 },
      unique: undefined,
      expireAfterSeconds: ONE_DAY_IN_SECONDS,
      partialFilterExpression: undefined,
    });
  });

  it('rejects a second running request of the same user', async () => {
    await create({ requestId: 'r1' });

    const err = await rejection(create({ requestId: 'r2' }));

    expect(err?.code).toBe(DUPLICATE_KEY);
    expect(err?.message).toContain(RUNNING_INDEX);
  });

  it('rejects a second running request of the same user from another relation', async () => {
    await create({ relationId: 'relation-1', requestId: 'r1' });

    const err = await rejection(
      create({ relationId: 'relation-2', requestId: 'r1' }),
    );

    expect(err?.code).toBe(DUPLICATE_KEY);
    expect(err?.message).toContain(RUNNING_INDEX);
  });

  it('does not let a finished request block a new running one', async () => {
    await create({ requestId: 'r1', state: 'done' });

    expect(await rejection(create({ requestId: 'r2' }))).toBeUndefined();
  });

  it('allows any number of finished requests of one user', async () => {
    await create({ requestId: 'r1', state: 'done' });

    expect(
      await rejection(create({ requestId: 'r2', state: 'done' })),
    ).toBeUndefined();
  });

  it('does not block a different user', async () => {
    await create({ requestId: 'r1' });

    expect(
      await rejection(create({ requestId: 'r2', userId: userB })),
    ).toBeUndefined();
  });

  it('rejects a second row with the same (relationId, requestId), whatever its state or user', async () => {
    await create({ requestId: 'r1', state: 'done' });

    const err = await rejection(
      create({ requestId: 'r1', userId: userB, state: 'done' }),
    );

    expect(err?.code).toBe(DUPLICATE_KEY);
    expect(err?.message).toContain(PAIR_INDEX);
  });

  it('accepts the same requestId under another relation', async () => {
    await create({ relationId: 'relation-1', requestId: 'r1', userId: userA });

    expect(
      await rejection(
        create({ relationId: 'relation-2', requestId: 'r1', userId: userB }),
      ),
    ).toBeUndefined();
  });

  it('is a no-op when run a second time', async () => {
    const afterFirst = await indexes();

    await migrate.up(db);

    expect(await indexes()).toEqual(afterFirst);
  });

  it('removes only its own indexes on rollback, keeping _id_', async () => {
    await migrate.down(db);

    expect((await indexes()).map((i) => i.name)).toEqual(['_id_']);
  });

  it('does not clash with indexes the model would create by itself', async () => {
    await ChatAgentRequest.init();
    const before = await indexes();

    await migrate.up(db);

    expect(await indexes()).toEqual(before);
  });
});
