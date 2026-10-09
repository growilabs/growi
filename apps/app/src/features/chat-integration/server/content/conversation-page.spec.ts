import type { KeepMessage } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { buildConversationPageBody } from './conversation-page';

const RELATION_ID = 'relation-1';

let seq = 0;

// biome-ignore lint/suspicious/noExplicitAny: the User model is registered by
// a crowi-wired factory and has no exported document type.
const getUserModel = (): any => mongoose.model('User');

const createUser = async (attrs: { status?: number } = {}) => {
  seq += 1;
  return getUserModel().create({
    name: `user ${seq}`,
    username: `user-${seq}`,
    email: `user-${seq}@example.com`,
    status: attrs.status ?? UserStatus.STATUS_ACTIVE,
  });
};

const link = async (
  userId: mongoose.Types.ObjectId,
  accountId: string,
  relationId = RELATION_ID,
) =>
  ChatAccountLink.create({
    relationId,
    userId,
    platform: 'slack',
    accountId,
    linkedAt: new Date(),
  });

const message = (
  accountId: string,
  displayName: string,
  markdown: string,
  postedAt = '2026-01-01T00:00:00.000Z',
): KeepMessage => ({
  postedAt,
  author: { platform: 'slack', accountId, displayName },
  markdown,
});

describe('buildConversationPageBody', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_conversation_page',
    ));
    // The User model is normally registered at boot by crowi; the factory
    // accepts a null crowi and only touches crowi from functions this spec
    // never calls.
    userModelFactory(null);
  });

  beforeEach(async () => {
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('attributes linked authors to their GROWI username and unlinked authors to their chat display name (Requirement 5.3)', async () => {
    const linkedUser = await createUser();
    await link(linkedUser._id, 'U_LINKED');

    const messages = [
      message('U_LINKED', 'Linked Person', 'first message'),
      message('U_UNLINKED', 'Unlinked Person', 'second message'),
    ];

    const body = await buildConversationPageBody(RELATION_ID, messages);

    expect(body).toContain(linkedUser.username);
    expect(body).not.toContain('Linked Person');
    expect(body).toContain('Unlinked Person');
    // The explicit anti-pattern this task names: no generic placeholder.
    expect(body).not.toMatch(/不明|unknown|未リンク/i);
  });

  it('queries chat_account_links exactly once regardless of message count (Requirement 5.3 -- batching)', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const userC = await createUser();
    await Promise.all([
      link(userA._id, 'U_A'),
      link(userB._id, 'U_B'),
      link(userC._id, 'U_C'),
    ]);

    // 10 messages from 3 distinct accounts.
    const messages: KeepMessage[] = [
      message('U_A', 'A', 'm1'),
      message('U_B', 'B', 'm2'),
      message('U_C', 'C', 'm3'),
      message('U_A', 'A', 'm4'),
      message('U_B', 'B', 'm5'),
      message('U_A', 'A', 'm6'),
      message('U_C', 'C', 'm7'),
      message('U_A', 'A', 'm8'),
      message('U_B', 'B', 'm9'),
      message('U_A', 'A', 'm10'),
    ];

    const findSpy = vi.spyOn(ChatAccountLink, 'find');

    const body = await buildConversationPageBody(RELATION_ID, messages);

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(body).toContain(userA.username);
    expect(body).toContain(userB.username);
    expect(body).toContain(userC.username);

    findSpy.mockRestore();
  });

  it('resolves every occurrence of a repeated accountId to the same username (Requirement 5.3)', async () => {
    const repeatedSpeaker = await createUser();
    await link(repeatedSpeaker._id, 'U_REPEAT');

    const messages = [
      message('U_REPEAT', 'Repeat Speaker', 'said this'),
      message('U_REPEAT', 'Repeat Speaker', 'said that'),
      message('U_REPEAT', 'Repeat Speaker', 'said the other thing'),
    ];

    const body = await buildConversationPageBody(RELATION_ID, messages);

    const occurrences = body.split(repeatedSpeaker.username).length - 1;
    expect(occurrences).toBe(3);
  });

  it('does not gate on user status -- a message from a now-suspended user still shows their username (display fact, not a permission decision)', async () => {
    const suspendedUser = await createUser({
      status: UserStatus.STATUS_SUSPENDED,
    });
    await link(suspendedUser._id, 'U_SUSPENDED');

    const body = await buildConversationPageBody(RELATION_ID, [
      message(
        'U_SUSPENDED',
        'Suspended Person',
        'a message from before suspension',
      ),
    ]);

    expect(body).toContain(suspendedUser.username);
    expect(body).not.toContain('Suspended Person');
  });

  it('renders each message as an author-attributed, ordered markdown block usable as a page body', async () => {
    const messages = [
      message(
        'U_1',
        'First Speaker',
        'first content',
        '2026-01-01T00:00:00.000Z',
      ),
      message(
        'U_2',
        'Second Speaker',
        'second content',
        '2026-01-01T00:05:00.000Z',
      ),
    ];

    const body = await buildConversationPageBody(RELATION_ID, messages);

    const firstIndex = body.indexOf('First Speaker');
    const secondIndex = body.indexOf('Second Speaker');
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(body).toContain('first content');
    expect(body).toContain('second content');
    expect(body).toContain('2026-01-01T00:00:00.000Z');
    expect(body).toContain('2026-01-01T00:05:00.000Z');
  });

  it('returns an empty body for an empty message list without throwing', async () => {
    const body = await buildConversationPageBody(RELATION_ID, []);
    expect(body).toBe('');
  });
});
