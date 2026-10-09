// Proves task 9.1's relation-listing contract: the admin screen sees every
// relation this GROWI has ever paired with -- active AND unpaired -- not
// only the live ones, and each row carries what the screen needs to render
// (workspace name, label, lifecycle state).

import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatRelation } from '../models/chat-relation';
import { listRelationsForAdmin } from './admin-service';

describe('listRelationsForAdmin', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_admin_service',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatRelation.deleteMany({});
  });

  it('returns an empty list when nothing has ever been paired', async () => {
    const relations = await listRelationsForAdmin();
    expect(relations).toEqual([]);
  });

  it('includes both active and unpaired relations, newest first', async () => {
    await ChatRelation.create({
      relationId: 'relation-old',
      proxyUri: 'https://proxy.example.test',
      platform: 'slack',
      workspaceId: 'workspace-old',
      workspaceName: 'Old Workspace',
      label: 'Old label',
      state: 'unpaired',
      unpairedAt: new Date('2026-01-01T00:00:00.000Z'),
      settingsVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await ChatRelation.create({
      relationId: 'relation-new',
      proxyUri: 'https://proxy.example.test',
      platform: 'discord',
      workspaceId: 'workspace-new',
      workspaceName: 'New Workspace',
      label: null,
      state: 'active',
      settingsVersion: 0,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const relations = await listRelationsForAdmin();

    expect(relations).toHaveLength(2);
    // Newest first.
    expect(relations[0].relationId).toBe('relation-new');
    expect(relations[0].state).toBe('active');
    expect(relations[0].label).toBeNull();
    expect(relations[0].unpairedAt).toBeNull();
    expect(relations[1].relationId).toBe('relation-old');
    expect(relations[1].state).toBe('unpaired');
    expect(relations[1].label).toBe('Old label');
    expect(relations[1].unpairedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
