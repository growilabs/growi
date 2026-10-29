import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { UNPAIRED_RETENTION_MS } from '../../unpaired-retention';
import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatRelation } from '../models/chat-relation';
import { inheritAccountLinks } from './inherit-account-links';
import { sweepUnpairedRelations } from './sweep-unpaired-relations';

const PLATFORM = 'slack' as const;
const WORKSPACE_ID = 'T-ACME';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-29T12:00:00.000Z');

const target = {
  relationId: 'relation-new',
  platform: PLATFORM,
  workspaceId: WORKSPACE_ID,
} as const;

const seedUnpaired = (relationId: string, unpairedAt: Date) =>
  ChatRelation.create({
    relationId,
    proxyUri: 'https://proxy.example.test',
    platform: PLATFORM,
    workspaceId: WORKSPACE_ID,
    workspaceName: 'Acme Workspace',
    state: 'unpaired',
    unpairedAt,
    settingsVersion: 0,
  });

const seedLink = (relationId: string, accountId: string) =>
  ChatAccountLink.create({
    relationId,
    userId: new Types.ObjectId(),
    platform: PLATFORM,
    accountId,
    linkedAt: new Date('2026-01-01'),
  });

const daysBefore = (days: number): Date =>
  new Date(NOW.getTime() - days * DAY_MS);

describe('inheritAccountLinks retention window', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_inherit_account_links',
    ));
    await ChatAccountLink.syncIndexes();
  });

  beforeEach(async () => {
    await Promise.all([
      ChatRelation.deleteMany({}),
      ChatAccountLink.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('inherits from a relation unpaired 44 days ago', async () => {
    await seedUnpaired('relation-old', daysBefore(44));
    await seedLink('relation-old', 'U1');

    const result = await inheritAccountLinks(target, NOW);

    expect(result).toEqual({
      inheritedFrom: 'relation-old',
      movedCount: 1,
      discardedCount: 0,
    });
    expect(
      await ChatAccountLink.countDocuments({ relationId: 'relation-new' }),
    ).toBe(1);
  });

  it('does not inherit from a relation unpaired 46 days ago and leaves its links alone', async () => {
    await seedUnpaired('relation-old', daysBefore(46));
    await seedLink('relation-old', 'U1');

    const result = await inheritAccountLinks(target, NOW);

    expect(result).toEqual({
      inheritedFrom: null,
      movedCount: 0,
      discardedCount: 0,
    });
    expect(
      await ChatAccountLink.countDocuments({ relationId: 'relation-new' }),
    ).toBe(0);
    expect(
      await ChatAccountLink.countDocuments({ relationId: 'relation-old' }),
    ).toBe(1);
  });

  it('still inherits from the in-window relation when an older expired relation also exists', async () => {
    await seedUnpaired('relation-expired', daysBefore(60));
    await seedLink('relation-expired', 'STALE');
    await seedUnpaired('relation-fresh', daysBefore(10));
    await seedLink('relation-fresh', 'FRESH');

    const result = await inheritAccountLinks(target, NOW);

    expect(result.inheritedFrom).toBe('relation-fresh');
  });

  describe('boundary agrees with the sweep', () => {
    it('inherits from a relation exactly at the retention boundary, which the sweep keeps', async () => {
      const unpairedAt = new Date(NOW.getTime() - UNPAIRED_RETENTION_MS);
      await seedUnpaired('relation-edge', unpairedAt);
      await seedLink('relation-edge', 'U1');

      const swept = await sweepUnpairedRelations(NOW);
      const result = await inheritAccountLinks(target, NOW);

      expect(swept.relations).toBe(0);
      expect(result.inheritedFrom).toBe('relation-edge');
    });

    it('does not inherit from a relation 1 ms past the boundary, which the sweep deletes', async () => {
      const unpairedAt = new Date(NOW.getTime() - UNPAIRED_RETENTION_MS - 1);
      await seedUnpaired('relation-edge', unpairedAt);
      await seedLink('relation-edge', 'U1');

      const result = await inheritAccountLinks(target, NOW);
      const swept = await sweepUnpairedRelations(NOW);

      expect(result.inheritedFrom).toBeNull();
      expect(swept.relations).toBe(1);
    });
  });
});
