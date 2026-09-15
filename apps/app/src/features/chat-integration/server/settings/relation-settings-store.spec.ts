// Proves task 9.2's storage-level contract against a real MongoDB replica
// set (design.md: "設定の保存は 1 つのトランザクションで行う"):
//
//   - a save bumps `chat_relations.settingsVersion` by EXACTLY 1 and stores
//     the permission rows, and the version the caller gets back is the one
//     that is now in the database (the proxy discards a push whose version
//     is not larger than its own copy, so an off-by-one here silently stops
//     every later save from taking effect)
//   - a save REPLACES the relation's rows wholesale -- the whole settings
//     object goes over the wire every time, so a row left behind from an
//     earlier save would be pushed as if it were still configured
//   - if any part of the write fails, NEITHER half is committed. This is
//     the failure design.md singles out: "版だけ進むと proxy は古い設定を
//     新しいものとして受け取る"
//   - a relation that is no longer paired is refused, so a save cannot put
//     back the permission rows `unpairRelation` deleted
//   - what is read back is what was saved, for all three `allowedChannels`
//     forms ('all' / 'none' / a list) -- `settingsPullHandler` hands this
//     straight to the proxy

import type { RelationSettings } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatRelation } from '../models/chat-relation';
import { ChatChannelPermission } from './models/chat-channel-permission';
import {
  readRelationSettings,
  writeRelationSettings,
} from './relation-settings-store';

const RELATION_ID = 'relation-under-test';
const INITIAL_VERSION = 7;

const seedRelation = () =>
  ChatRelation.create({
    relationId: RELATION_ID,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: 'workspace-0001',
    workspaceName: 'Test Workspace',
    label: null,
    state: 'active',
    settingsVersion: INITIAL_VERSION,
    createdAt: new Date(),
  });

const currentVersion = async (): Promise<number | undefined> =>
  (await ChatRelation.findOne({ relationId: RELATION_ID }).lean())
    ?.settingsVersion;

describe('relation-settings-store', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_relation_settings_store',
    ));
    // The (relationId, commandName) unique index has to actually exist in
    // this database for the rollback test below to exercise a real failed
    // write inside the transaction.
    await ChatChannelPermission.init();
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatRelation.deleteMany({});
    await ChatChannelPermission.deleteMany({});
    await seedRelation();
  });

  it('bumps settingsVersion by exactly 1 and stores the rows', async () => {
    const result = await writeRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: ['C0001'] },
      { commandName: 'create-page', allowedChannels: 'all' },
    ]);

    expect(result).toEqual({ status: 'saved', version: INITIAL_VERSION + 1 });
    expect(await currentVersion()).toBe(INITIAL_VERSION + 1);

    const read = await readRelationSettings(RELATION_ID);
    expect(read?.version).toBe(INITIAL_VERSION + 1);
    expect(read?.settings.channelPermissions).toEqual(
      expect.arrayContaining([
        { commandName: 'search', allowedChannels: ['C0001'] },
        { commandName: 'create-page', allowedChannels: 'all' },
      ]),
    );
  });

  it('increments the version once per save, never by more', async () => {
    await writeRelationSettings(RELATION_ID, []);
    await writeRelationSettings(RELATION_ID, []);
    await writeRelationSettings(RELATION_ID, []);

    expect(await currentVersion()).toBe(INITIAL_VERSION + 3);
  });

  it("replaces the relation's rows wholesale, leaving no row from an earlier save", async () => {
    await writeRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: ['C0001'] },
      { commandName: 'keep', allowedChannels: 'all' },
    ]);

    await writeRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: ['C0002'] },
    ]);

    const read = await readRelationSettings(RELATION_ID);
    expect(read?.settings.channelPermissions).toEqual([
      { commandName: 'search', allowedChannels: ['C0002'] },
    ]);
  });

  it("leaves another relation's rows untouched", async () => {
    await ChatChannelPermission.create({
      relationId: 'some-other-relation',
      commandName: 'search',
      channelScope: 'listed',
      allowedChannels: ['C9999'],
    });

    await writeRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: 'none' },
    ]);

    const otherRows = await ChatChannelPermission.find({
      relationId: 'some-other-relation',
    }).lean();
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0].allowedChannels).toEqual(['C9999']);
  });

  it('commits neither the version bump nor the rows when a row write fails', async () => {
    await writeRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: ['C0001'] },
    ]);
    const versionBeforeFailure = await currentVersion();

    // Two rows for the same command violate the (relationId, commandName)
    // unique index, so the row write fails mid-transaction. Whatever the
    // cause, the guarantee is the same: no half-written save.
    const duplicated = [
      { commandName: 'keep', allowedChannels: ['C0002'] },
      { commandName: 'keep', allowedChannels: ['C0003'] },
    ] as unknown as RelationSettings['channelPermissions'];

    await expect(
      writeRelationSettings(RELATION_ID, duplicated),
    ).rejects.toThrow();

    expect(await currentVersion()).toBe(versionBeforeFailure);
    const read = await readRelationSettings(RELATION_ID);
    expect(read?.settings.channelPermissions).toEqual([
      { commandName: 'search', allowedChannels: ['C0001'] },
    ]);
  });

  it.each([
    'all',
    'none',
  ] as const)("round trips allowedChannels '%s' through storage unchanged", async (allowedChannels) => {
    await writeRelationSettings(RELATION_ID, [
      { commandName: 'create-page', allowedChannels },
    ]);

    const read = await readRelationSettings(RELATION_ID);
    expect(read?.settings.channelPermissions).toEqual([
      { commandName: 'create-page', allowedChannels },
    ]);
  });

  describe('an unknown relation', () => {
    it('reports relation-not-found and writes nothing', async () => {
      const result = await writeRelationSettings('no-such-relation', [
        { commandName: 'search', allowedChannels: 'all' },
      ]);

      expect(result).toEqual({ status: 'relation-not-found' });
      expect(
        await ChatChannelPermission.countDocuments({
          relationId: 'no-such-relation',
        }),
      ).toBe(0);
      // The relation that DOES exist must not have been bumped either.
      expect(await currentVersion()).toBe(INITIAL_VERSION);
    });

    it('reads as null rather than as empty settings', async () => {
      expect(await readRelationSettings('no-such-relation')).toBeNull();
    });
  });

  describe('a relation that is no longer paired', () => {
    // `unpairRelation` deletes the relation's permission rows on purpose.
    // The save endpoint takes a raw POST for any relation id, so without a
    // `state` filter a save would put those rows back and bump the dead
    // relation's version -- refused here exactly like an unknown relation,
    // since neither is a relation an administrator can configure.
    beforeEach(async () => {
      await ChatRelation.updateOne(
        { relationId: RELATION_ID },
        { $set: { state: 'unpaired', unpairedAt: new Date() } },
      );
    });

    it('refuses the save, writing no rows and leaving the version alone', async () => {
      const result = await writeRelationSettings(RELATION_ID, [
        { commandName: 'search', allowedChannels: 'all' },
      ]);

      expect(result).toEqual({ status: 'relation-not-found' });
      expect(
        await ChatChannelPermission.countDocuments({ relationId: RELATION_ID }),
      ).toBe(0);
      expect(await currentVersion()).toBe(INITIAL_VERSION);
    });
  });
});
