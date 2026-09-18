// Task 8.2's second half: the 90-day sweep design.md defers here from
// `inherit-account-links.ts` ("解除済みの `chat_relations` の行そのものも 90 日で
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
});
