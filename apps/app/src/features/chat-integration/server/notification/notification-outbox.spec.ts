import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatNotificationOutbox } from './models/chat-notification-outbox';
import { notificationOutbox } from './notification-outbox';

describe('notificationOutbox.enqueue', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_notification_outbox',
    ));
  });

  beforeEach(async () => {
    await ChatNotificationOutbox.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('creates exactly one row with all fields persisted and a requestId assigned', async () => {
    await notificationOutbox.enqueue({
      relationId: 'rel-1',
      targets: [{ platform: 'slack', channelId: 'C1' }],
      markdown: 'someone created [/a](https://growi.example.com/a)',
      containsRestrictedPage: false,
    });

    const rows = await ChatNotificationOutbox.find({});
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.relationId).toBe('rel-1');
    expect(row.toObject().targets).toEqual([
      { platform: 'slack', channelId: 'C1' },
    ]);
    expect(row.markdown).toBe(
      'someone created [/a](https://growi.example.com/a)',
    );
    expect(row.containsRestrictedPage).toBe(false);
    expect(row.state).toBe('pending');
    expect(typeof row.requestId).toBe('string');
    expect(row.requestId.length).toBeGreaterThan(0);
  });

  it('mints a FRESH requestId for each call -- two enqueue calls for the same relation never reuse an id', async () => {
    await notificationOutbox.enqueue({
      relationId: 'rel-1',
      targets: [{ platform: 'slack', channelId: 'C1' }],
      markdown: 'first notification',
      containsRestrictedPage: false,
    });
    await notificationOutbox.enqueue({
      relationId: 'rel-1',
      targets: [{ platform: 'slack', channelId: 'C1' }],
      markdown: 'second, unrelated notification',
      containsRestrictedPage: false,
    });

    const rows = await ChatNotificationOutbox.find({}).sort({ markdown: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0].requestId).not.toBe(rows[1].requestId);

    // This proves ONLY that a brand-new logical notification gets a fresh
    // id -- it does NOT cover "retry of the same notification keeps its
    // id", which is task 8.2's NotificationDispatcher concern (it re-signs
    // and resends against the SAME row/requestId already on disk; it never
    // calls `enqueue` again for a retry).
  });

  it('persists a restricted page notification with containsRestrictedPage true', async () => {
    await notificationOutbox.enqueue({
      relationId: 'rel-1',
      targets: [{ platform: 'discord', channelId: 'D1' }],
      markdown: 'someone edited [/secret](https://growi.example.com/secret)',
      containsRestrictedPage: true,
    });

    const [row] = await ChatNotificationOutbox.find({});
    expect(row.containsRestrictedPage).toBe(true);
  });
});
