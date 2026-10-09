// Requirement 2.2's server half: what can the person saving a page choose
// a notification destination from? Every case is stated as "what does the
// caller get back", so the query shape underneath can change freely.

import type { ChannelInventory } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatRelation } from '../models/chat-relation';
import * as proxyClient from '../proxy-client';
import { buildSaveTimeChannelsView } from './save-time-channels';

vi.mock('../proxy-client', async (importOriginal) => {
  const actual = await importOriginal<typeof proxyClient>();
  return { ...actual, fetchChannels: vi.fn() };
});

const channel = (channelId: string, channelName: string) => ({
  platform: 'slack' as const,
  channelId,
  channelName,
  isPrivate: false,
});

const inventoryOf = (
  channels: ChannelInventory['channels'],
): { ok: true; response: ChannelInventory } => ({
  ok: true,
  response: { channels },
});

const seedRelation = (
  overrides: Partial<{
    relationId: string;
    workspaceName: string;
    state: 'active' | 'unpaired';
  }> = {},
) =>
  ChatRelation.create({
    relationId: 'relation-a',
    platform: 'slack',
    workspaceId: 'W-a',
    workspaceName: 'Workspace A',
    label: null,
    state: 'active',
    proxyUri: 'https://proxy.example.com',
    createdAt: new Date(),
    unpairedAt: null,
    ...overrides,
  });

describe('buildSaveTimeChannelsView', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_chat_save_time_channels',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await ChatRelation.deleteMany({});
  });

  it('offers every channel of every paired workspace, each carrying its own relation', async () => {
    // The relation has to travel with the channel: the same channel id can
    // exist in two workspaces, and the save has no other way to tell which
    // outbox the destination belongs to.
    await seedRelation();
    await seedRelation({
      relationId: 'relation-b',
      workspaceName: 'Workspace B',
    });
    vi.mocked(proxyClient.fetchChannels).mockImplementation(
      async (relationId: string) =>
        relationId === 'relation-a'
          ? inventoryOf([channel('C0001', 'general')])
          : inventoryOf([channel('C0001', 'general-b')]),
    );

    const view = await buildSaveTimeChannelsView();

    expect(view.channels).toEqual([
      {
        relationId: 'relation-a',
        workspaceName: 'Workspace A',
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        isPrivate: false,
      },
      {
        relationId: 'relation-b',
        workspaceName: 'Workspace B',
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general-b',
        isPrivate: false,
      },
    ]);
    expect(view.unavailableRelations).toEqual([]);
  });

  it('does not offer channels of a relation that is no longer paired', async () => {
    await seedRelation({ relationId: 'gone', state: 'unpaired' });
    vi.mocked(proxyClient.fetchChannels).mockResolvedValue(
      inventoryOf([channel('C0001', 'general')]),
    );

    const view = await buildSaveTimeChannelsView();

    expect(view.channels).toEqual([]);
    expect(proxyClient.fetchChannels).not.toHaveBeenCalled();
  });

  it('keeps the other workspaces usable when one proxy cannot be reached', async () => {
    await seedRelation();
    await seedRelation({
      relationId: 'relation-b',
      workspaceName: 'Workspace B',
    });
    vi.mocked(proxyClient.fetchChannels).mockImplementation(
      async (relationId: string) =>
        relationId === 'relation-a'
          ? inventoryOf([channel('C0001', 'general')])
          : { ok: false, reason: 'unreachable' },
    );

    const view = await buildSaveTimeChannelsView();

    expect(view.channels.map((option) => option.relationId)).toEqual([
      'relation-a',
    ]);
    expect(view.unavailableRelations).toEqual([
      {
        relationId: 'relation-b',
        workspaceName: 'Workspace B',
        reason: 'unreachable',
      },
    ]);
  });

  it('offers nothing at all when no workspace is paired', async () => {
    const view = await buildSaveTimeChannelsView();

    expect(view).toEqual({ channels: [], unavailableRelations: [] });
  });
});
