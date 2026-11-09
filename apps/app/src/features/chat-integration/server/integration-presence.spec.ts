import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import {
  createIntegrationPresence,
  PRESENCE_ANSWER_TTL_MS,
} from './integration-presence';
import { ChatRelation } from './models/chat-relation';

const T0 = new Date('2030-01-01T00:00:00.000Z');
const after = (base: Date, ms: number): Date => new Date(base.getTime() + ms);
const MINUTE_MS = 60 * 1000;

const countingQuery = (...answers: boolean[]) => {
  const queue = [...answers];
  const query = vi.fn(async () => queue.shift() ?? false);
  return query;
};

describe('IntegrationPresence', () => {
  it('trusts a remembered answer for 10 minutes and asks again exactly at 10 minutes', async () => {
    const query = countingQuery(false, false);
    const presence = createIntegrationPresence({ anyRelationExists: query });

    expect(await presence.hasAnyIntegration(T0)).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);

    expect(
      await presence.hasAnyIntegration(after(T0, PRESENCE_ANSWER_TTL_MS - 1)),
    ).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);

    expect(
      await presence.hasAnyIntegration(after(T0, PRESENCE_ANSWER_TTL_MS)),
    ).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('answers true without asking after markPresent, even though "none" was remembered', async () => {
    const query = countingQuery(false);
    const presence = createIntegrationPresence({ anyRelationExists: query });
    await presence.hasAnyIntegration(T0);

    presence.markPresent(after(T0, MINUTE_MS));

    expect(await presence.hasAnyIntegration(after(T0, MINUTE_MS))).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('counts the marked answer from the marking time, not from the earlier answer', async () => {
    const query = countingQuery(false, false);
    const presence = createIntegrationPresence({ anyRelationExists: query });
    await presence.hasAnyIntegration(T0);
    presence.markPresent(after(T0, 5 * MINUTE_MS));

    expect(
      await presence.hasAnyIntegration(
        after(T0, 5 * MINUTE_MS + PRESENCE_ANSWER_TTL_MS - 1),
      ),
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);

    expect(
      await presence.hasAnyIntegration(
        after(T0, 5 * MINUTE_MS + PRESENCE_ANSWER_TTL_MS),
      ),
    ).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('lets a remembered "present" expire too, so a swept-out last relation is noticed', async () => {
    const query = countingQuery(true, false);
    const presence = createIntegrationPresence({ anyRelationExists: query });

    expect(await presence.hasAnyIntegration(T0)).toBe(true);
    expect(
      await presence.hasAnyIntegration(after(T0, PRESENCE_ANSWER_TTL_MS - 1)),
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);

    expect(
      await presence.hasAnyIntegration(after(T0, PRESENCE_ANSWER_TTL_MS)),
    ).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('answers true when the query fails and asks again on the next call', async () => {
    const query = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(false);
    const presence = createIntegrationPresence({ anyRelationExists: query });

    expect(await presence.hasAnyIntegration(T0)).toBe(true);
    expect(await presence.hasAnyIntegration(after(T0, MINUTE_MS))).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('shares one query between concurrent callers whose answer has expired', async () => {
    let resolveQuery: (value: boolean) => void = () => {};
    const query = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const presence = createIntegrationPresence({ anyRelationExists: query });

    const first = presence.hasAnyIntegration(T0);
    const second = presence.hasAnyIntegration(T0);
    resolveQuery(true);

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('asks again after a shared query has finished and the answer expired', async () => {
    const query = countingQuery(true, false);
    const presence = createIntegrationPresence({ anyRelationExists: query });

    await Promise.all([
      presence.hasAnyIntegration(T0),
      presence.hasAnyIntegration(T0),
    ]);
    expect(
      await presence.hasAnyIntegration(after(T0, PRESENCE_ANSWER_TTL_MS)),
    ).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps a markPresent made while an older query is still running', async () => {
    let resolveQuery: (value: boolean) => void = () => {};
    const query = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const presence = createIntegrationPresence({ anyRelationExists: query });

    const pending = presence.hasAnyIntegration(T0);
    presence.markPresent(after(T0, MINUTE_MS));
    resolveQuery(false);

    expect(await pending).toBe(false);
    expect(await presence.hasAnyIntegration(after(T0, MINUTE_MS))).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('answers true and asks again when the query throws synchronously', async () => {
    const query = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => {
        throw new Error('sync failure');
      })
      .mockResolvedValueOnce(false);
    const presence = createIntegrationPresence({ anyRelationExists: query });

    expect(await presence.hasAnyIntegration(T0)).toBe(true);
    expect(await presence.hasAnyIntegration(after(T0, MINUTE_MS))).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('IntegrationPresence default query', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_integration_presence',
    ));
  });

  beforeEach(async () => {
    await ChatRelation.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  const seedRelation = (state: 'active' | 'unpaired') =>
    ChatRelation.create({
      relationId: `rel-${state}`,
      proxyUri: 'https://proxy.example.test',
      platform: 'slack',
      workspaceId: `W-${state}`,
      workspaceName: 'Acme',
      label: null,
      state,
      unpairedAt: state === 'unpaired' ? T0 : null,
      settingsVersion: 1,
    });

  it('answers false when chat_relations is empty', async () => {
    const presence = createIntegrationPresence();

    expect(await presence.hasAnyIntegration(T0)).toBe(false);
  });

  it('answers true for an unpaired relation alone, so the sweep is not skipped', async () => {
    await seedRelation('unpaired');
    const presence = createIntegrationPresence();

    expect(await presence.hasAnyIntegration(T0)).toBe(true);
  });

  it('answers true for an active relation', async () => {
    await seedRelation('active');
    const presence = createIntegrationPresence();

    expect(await presence.hasAnyIntegration(T0)).toBe(true);
  });
});
