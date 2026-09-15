// End-to-end wiring test for task 8.1's real (non-stub) Gen 2 dispatch path:
// admin-configured, path-matched destinations (契機1) really land in
// chat_notification_outbox, and destinations -- whether they belong to
// different relations or the same one -- never collapse into a single
// "1件だけ入れて終わる" row. This is the piece task 2.3 deliberately left as
// a placeholder ("受け側は仮のものでよい").
//
// Note on row granularity: enqueue() is called once per DESTINATION, not
// once per relation with every destination batched into `targets` --
// design.md's own `enqueue` interface allows a multi-element `targets`
// array, but this implementation deliberately keeps DestinationRegistry's
// per-destination dispatch shape (see destination-dispatcher.ts's own
// comment) rather than grouping by relationId before enqueueing. Each row
// is still independently retryable per task 8.2's
// (relationId, requestId, platform, channelId) unit, so this does not
// affect delivery correctness -- it just means 2 destinations on the same
// relation produce 2 rows with 2 different requestIds, not 1 row with a
// 2-element targets array. The test below pins this actual behavior.
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatNotificationDestination } from '../models/chat-notification-destination';
import { createGen2NotificationDispatcher } from './destination-dispatcher';
import { DestinationRegistry } from './destination-registry';
import { findGen2DestinationsForPathAndEvent } from './find-destinations-for-path-and-event';
import { ChatNotificationOutbox } from './models/chat-notification-outbox';

describe('Gen 2 notification dispatch -- real path matching + real outbox writes', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_gen2_notification_flow',
    ));
  });

  beforeEach(async () => {
    await ChatNotificationDestination.deleteMany({});
    await ChatNotificationOutbox.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('an admin-configured, path-matched destination (契機1) produces an outbox row for the correct relation + channel', async () => {
    await ChatNotificationDestination.create({
      relationId: 'rel-admin-1',
      platform: 'slack',
      channelId: 'C-admin',
      channelName: 'general',
      pathPattern: '/*',
      triggerEvents: ['pageCreate'],
    });

    const destinations = await findGen2DestinationsForPathAndEvent(
      '/a/b',
      'pageCreate',
    );
    const registry = new DestinationRegistry(destinations);
    await registry.dispatchAll(
      createGen2NotificationDispatcher('someone created [/a/b](url)', false),
    );

    const rows = await ChatNotificationOutbox.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].relationId).toBe('rel-admin-1');
    expect(rows[0].toObject().targets).toEqual([
      { platform: 'slack', channelId: 'C-admin' },
    ]);
  });

  it('a save-time explicit destination (契機2) lands in the SAME outbox collection', async () => {
    // Simulates what UserNotificationService.fire does with the caller's
    // own chatIntegrationDestinations -- no admin config involved at all.
    const explicitDestinations = [
      {
        relationId: 'rel-explicit-1',
        platform: 'discord',
        channelId: 'D-explicit',
      },
    ];
    const registry = new DestinationRegistry(explicitDestinations);
    await registry.dispatchAll(
      createGen2NotificationDispatcher('someone commented', false),
    );

    const rows = await ChatNotificationOutbox.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].relationId).toBe('rel-explicit-1');
    expect(rows[0].toObject().targets).toEqual([
      { platform: 'discord', channelId: 'D-explicit' },
    ]);
  });

  it('destinations across 2+ DIFFERENT relations produce 2+ SEPARATE outbox rows (not a single row)', async () => {
    await ChatNotificationDestination.create([
      {
        relationId: 'rel-1',
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      },
      {
        relationId: 'rel-2',
        platform: 'discord',
        channelId: 'D1',
        channelName: 'random',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      },
    ]);

    const destinations = await findGen2DestinationsForPathAndEvent(
      '/x',
      'pageCreate',
    );
    const registry = new DestinationRegistry(destinations);
    await registry.dispatchAll(createGen2NotificationDispatcher('body', false));

    const rows = await ChatNotificationOutbox.find({}).sort({ relationId: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.relationId)).toEqual(['rel-1', 'rel-2']);
  });

  it('2 destinations on the SAME relation produce 2 SEPARATE rows, each with its own requestId', async () => {
    await ChatNotificationDestination.create([
      {
        relationId: 'rel-shared',
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      },
      {
        relationId: 'rel-shared',
        platform: 'slack',
        channelId: 'C2',
        channelName: 'random',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      },
    ]);

    const destinations = await findGen2DestinationsForPathAndEvent(
      '/x',
      'pageCreate',
    );
    const registry = new DestinationRegistry(destinations);
    await registry.dispatchAll(createGen2NotificationDispatcher('body', false));

    const rows = await ChatNotificationOutbox.find({}).sort({
      'targets.0.channelId': 1,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.relationId === 'rel-shared')).toBe(true);
    expect(rows.map((r) => r.toObject().targets)).toEqual([
      [{ platform: 'slack', channelId: 'C1' }],
      [{ platform: 'slack', channelId: 'C2' }],
    ]);
    // Each row is independently retryable (task 8.2's per-row unit), so the
    // two requestIds must differ even though relationId is the same.
    expect(rows[0].requestId).not.toBe(rows[1].requestId);
  });
});
