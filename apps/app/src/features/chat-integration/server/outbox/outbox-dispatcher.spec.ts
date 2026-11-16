import type { AgentAnswer } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatNotificationOutbox } from './models/chat-outbox';
import type { Deliverer } from './outbox-dispatcher';
import { createOutboxDispatcher } from './outbox-dispatcher';

const ANSWER: AgentAnswer = {
  kind: 'text',
  markdown: 'the answer',
  sources: [],
};

const seedNotificationRow = () =>
  ChatNotificationOutbox.create({
    kind: 'notification',
    requestId: 'req-notification',
    relationId: 'rel-1',
    targets: [{ platform: 'slack', channelId: 'C1' }],
    markdown: 'someone created /a',
    containsRestrictedPage: false,
  });

const seedAnswerRow = () =>
  ChatNotificationOutbox.create({
    kind: 'command-answer',
    requestId: 'req-answer',
    relationId: 'rel-1',
    answer: ANSWER,
  });

const sendingDeliverer = () =>
  vi.fn<Deliverer>().mockResolvedValue({ outcome: 'sent' });

describe('createOutboxDispatcher kind routing', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_outbox_dispatcher',
    ));
  });

  beforeEach(async () => {
    await ChatNotificationOutbox.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('sends each row through the deliverer registered for its kind', async () => {
    await seedNotificationRow();
    await seedAnswerRow();
    const notification = sendingDeliverer();
    const commandAnswer = sendingDeliverer();

    const summary = await createOutboxDispatcher({
      deliverers: { notification, 'command-answer': commandAnswer },
    }).drain(new Date());

    expect(summary).toEqual({ sent: 2, failed: 0, givenUp: 0 });
    expect(notification.mock.calls.map(([row]) => row.requestId)).toEqual([
      'req-notification',
    ]);
    expect(commandAnswer.mock.calls.map(([row]) => row.requestId)).toEqual([
      'req-answer',
    ]);
    const states = await ChatNotificationOutbox.find({}).distinct('state');
    expect(states).toEqual(['sent']);
  });

  // A row of a kind this process has no deliverer for is never claimed, so
  // a process that knows the kind can still send it.
  it('leaves a row whose kind has no deliverer pending and untouched, while still sending the rest', async () => {
    await seedNotificationRow();
    const answerRow = await seedAnswerRow();
    const before = await ChatNotificationOutbox.collection.findOne({
      _id: answerRow._id,
    });
    const notification = sendingDeliverer();

    const summary = await createOutboxDispatcher({
      deliverers: { notification },
    }).drain(new Date());

    expect(summary).toEqual({ sent: 1, failed: 0, givenUp: 0 });
    expect(notification).toHaveBeenCalledTimes(1);
    const after = await ChatNotificationOutbox.collection.findOne({
      _id: answerRow._id,
    });
    expect(after).toEqual(before);
    expect(after?.state).toBe('pending');
  });

  it('writes the result a deliverer reports onto the row', async () => {
    await seedNotificationRow();
    const result = { outcomes: [] };

    await createOutboxDispatcher({
      deliverers: {
        notification: vi
          .fn<Deliverer>()
          .mockResolvedValue({ outcome: 'sent', result }),
      },
    }).drain(new Date());

    const row = await ChatNotificationOutbox.findOne({});
    expect(row?.state).toBe('sent');
    expect(row?.result).toEqual(result);
  });
});
