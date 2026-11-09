// Task 8.2's second half: the sweep design.md defers here from
// `inherit-account-links.ts` ("解除済みの `chat_relations` の行そのものも 45 日で
// 消す（`chat_account_links` と揃える）").

import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatRelation } from '../models/chat-relation';
import {
  sweepUnpairedRelations,
  UNPAIRED_RETENTION_MS,
} from './sweep-unpaired-relations';

const DAY_MS = 24 * 60 * 60 * 1000;

const seedRelation = (
  relationId: string,
  state: 'active' | 'unpaired',
  unpairedAt: Date | null,
) =>
  ChatRelation.create({
    relationId,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: `W-${relationId}`,
    workspaceName: 'Acme',
    label: null,
    state,
    unpairedAt,
    settingsVersion: 1,
  });

const seedLink = (relationId: string, accountId: string) =>
  ChatAccountLink.create({
    relationId,
    userId: new Types.ObjectId(),
    platform: 'slack',
    accountId,
  });

describe('sweepUnpairedRelations', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_sweep_unpaired_relations',
    ));
  });

  beforeEach(async () => {
    await ChatRelation.deleteMany({});
    await ChatAccountLink.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('keeps an unpaired relation for 45 days', () => {
    expect(UNPAIRED_RETENTION_MS).toBe(45 * DAY_MS);
  });

  it('deletes an unpaired relation past the retention period together with its account links', async () => {
    const now = new Date();
    await seedRelation(
      'rel-old',
      'unpaired',
      new Date(now.getTime() - UNPAIRED_RETENTION_MS - DAY_MS),
    );
    await seedLink('rel-old', 'U-1');
    await seedLink('rel-old', 'U-2');

    const summary = await sweepUnpairedRelations(now);

    expect(summary).toEqual({ relations: 1, accountLinks: 2 });
    expect(await ChatRelation.countDocuments({})).toBe(0);
    expect(await ChatAccountLink.countDocuments({})).toBe(0);
  });

  it('keeps an unpaired relation that is still within the retention period', async () => {
    const now = new Date();
    await seedRelation(
      'rel-recent',
      'unpaired',
      new Date(now.getTime() - UNPAIRED_RETENTION_MS + DAY_MS),
    );
    await seedLink('rel-recent', 'U-1');

    const summary = await sweepUnpairedRelations(now);

    expect(summary).toEqual({ relations: 0, accountLinks: 0 });
    expect(await ChatRelation.countDocuments({})).toBe(1);
    expect(await ChatAccountLink.countDocuments({})).toBe(1);
  });

  it('never touches an active relation, however old it is', async () => {
    const now = new Date();
    await seedRelation('rel-active', 'active', null);
    await seedLink('rel-active', 'U-1');

    const summary = await sweepUnpairedRelations(now);

    expect(summary).toEqual({ relations: 0, accountLinks: 0 });
    expect(await ChatRelation.countDocuments({})).toBe(1);
    expect(await ChatAccountLink.countDocuments({})).toBe(1);
  });

  it('deletes only the expired relation’s own links, leaving other relations’ links alone', async () => {
    const now = new Date();
    await seedRelation(
      'rel-old',
      'unpaired',
      new Date(now.getTime() - UNPAIRED_RETENTION_MS - DAY_MS),
    );
    await seedLink('rel-old', 'U-1');
    await seedRelation('rel-live', 'active', null);
    await seedLink('rel-live', 'U-1');

    const summary = await sweepUnpairedRelations(now);

    expect(summary).toEqual({ relations: 1, accountLinks: 1 });
    const remaining = await ChatAccountLink.find({}).lean();
    expect(remaining.map((l) => l.relationId)).toEqual(['rel-live']);
    const relations = await ChatRelation.find({}).lean();
    expect(relations.map((r) => r.relationId)).toEqual(['rel-live']);
  });

  it('clears every expired relation in one call', async () => {
    const now = new Date();
    const expired = new Date(now.getTime() - UNPAIRED_RETENTION_MS - DAY_MS);
    await seedRelation('rel-1', 'unpaired', expired);
    await seedRelation('rel-2', 'unpaired', expired);
    await seedRelation('rel-3', 'unpaired', expired);

    const summary = await sweepUnpairedRelations(now);

    expect(summary).toEqual({ relations: 3, accountLinks: 0 });
    expect(await ChatRelation.countDocuments({})).toBe(0);
  });

  describe('with a backlog larger than one pass', () => {
    const seedExpired = async (count: number, now: Date) => {
      const expired = new Date(now.getTime() - UNPAIRED_RETENTION_MS - DAY_MS);
      const ids = Array.from({ length: count }, (_, i) => `rel-${i}`);
      await ChatRelation.insertMany(
        ids.map((relationId) => ({
          relationId,
          proxyUri: 'https://proxy.example.test',
          platform: 'slack',
          workspaceId: `W-${relationId}`,
          workspaceName: 'Acme',
          label: null,
          state: 'unpaired',
          unpairedAt: expired,
          settingsVersion: 1,
        })),
      );
      await ChatAccountLink.insertMany(
        ids.map((relationId) => ({
          relationId,
          userId: new Types.ObjectId(),
          platform: 'slack',
          accountId: `U-${relationId}`,
        })),
      );
    };

    it('removes every expired relation and its links in one call, leaving the rest', async () => {
      const now = new Date();
      await seedExpired(250, now);
      await seedRelation('rel-live', 'active', null);
      await seedLink('rel-live', 'U-live');
      await seedRelation(
        'rel-recent',
        'unpaired',
        new Date(now.getTime() - UNPAIRED_RETENTION_MS + DAY_MS),
      );
      await seedLink('rel-recent', 'U-recent');

      const summary = await sweepUnpairedRelations(now);

      expect(summary).toEqual({ relations: 250, accountLinks: 250 });
      const relations = await ChatRelation.find({}).lean();
      expect(relations.map((r) => r.relationId).sort()).toEqual([
        'rel-live',
        'rel-recent',
      ]);
      expect(await ChatAccountLink.countDocuments({})).toBe(2);
    });

    it('stops at the per-call ceiling and leaves the remainder for the next run', async () => {
      const now = new Date();
      await seedExpired(12, now);

      const first = await sweepUnpairedRelations(now, { maxRelations: 5 });

      expect(first).toEqual({ relations: 5, accountLinks: 5 });
      expect(await ChatRelation.countDocuments({})).toBe(7);
      expect(await ChatAccountLink.countDocuments({})).toBe(7);

      const second = await sweepUnpairedRelations(now, { maxRelations: 100 });

      expect(second).toEqual({ relations: 7, accountLinks: 7 });
      expect(await ChatRelation.countDocuments({})).toBe(0);
    });

    it('converges to a consistent result when runs overlap', async () => {
      const now = new Date();
      await seedExpired(60, now);

      const summaries = await Promise.all([
        sweepUnpairedRelations(now),
        sweepUnpairedRelations(now),
        sweepUnpairedRelations(now),
      ]);

      expect(summaries.reduce((sum, s) => sum + s.relations, 0)).toBe(60);
      expect(await ChatRelation.countDocuments({})).toBe(0);
      expect(await ChatAccountLink.countDocuments({})).toBe(0);
    });
  });
});
