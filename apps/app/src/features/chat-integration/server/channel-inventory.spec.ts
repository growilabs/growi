// What task 9.3 needs proved about the stored channel names: after the
// admin screen pulls the channel list, a destination that was saved under
// an OLD name carries the current one -- otherwise Requirement 12.4's
// overlap warning is decided by a name the chat service abandoned.

import type { ChannelInventory } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import {
  afterAll,
  afterEach,
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

import {
  loadChannelInventory,
  refreshDestinationChannelNames,
} from './channel-inventory';
import { ChatNotificationDestination } from './models/chat-notification-destination';
import * as proxyClient from './proxy-client';

vi.mock('./proxy-client', async (importOriginal) => {
  const actual = await importOriginal<typeof proxyClient>();
  return { ...actual, fetchChannels: vi.fn() };
});

const RELATION_ID = 'relation-under-test';

const inventory = (
  channels: ChannelInventory['channels'],
): ChannelInventory => ({ channels });

const channel = (channelId: string, channelName: string) => ({
  platform: 'slack' as const,
  channelId,
  channelName,
  isPrivate: false,
});

const seedDestination = (
  overrides: Partial<{
    relationId: string;
    channelId: string;
    channelName: string;
  }> = {},
) =>
  ChatNotificationDestination.create({
    relationId: RELATION_ID,
    platform: 'slack',
    channelId: 'C0001',
    channelName: 'old-name',
    pathPattern: '/*',
    triggerEvents: ['pageCreate'],
    ...overrides,
  });

const storedNameOf = async (channelId: string, relationId = RELATION_ID) => {
  const row = await ChatNotificationDestination.findOne({
    relationId,
    channelId,
  });
  return row?.channelName;
};

describe('channel inventory (task 9.3)', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_chat_channel_inventory',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await ChatNotificationDestination.deleteMany({});
  });

  afterEach(async () => {
    // Restores the `bulkWrite` spies the write-count tests install, so they
    // cannot count a later test's writes.
    vi.restoreAllMocks();
    await ChatNotificationDestination.deleteMany({});
  });

  describe('refreshDestinationChannelNames', () => {
    it('replaces a stored name with the one the chat service reports now', async () => {
      await seedDestination();

      const refreshed = await refreshDestinationChannelNames(RELATION_ID, [
        channel('C0001', 'renamed-channel'),
      ]);

      expect(refreshed).toBe(1);
      await expect(storedNameOf('C0001')).resolves.toBe('renamed-channel');
    });

    it('matches by identifier, so every destination on the same channel is updated', async () => {
      await seedDestination({ channelId: 'C0001' });
      await ChatNotificationDestination.create({
        relationId: RELATION_ID,
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'old-name',
        pathPattern: '/docs/*',
        triggerEvents: ['pageEdit'],
      });

      await refreshDestinationChannelNames(RELATION_ID, [
        channel('C0001', 'renamed-channel'),
      ]);

      const rows = await ChatNotificationDestination.find({
        relationId: RELATION_ID,
      });
      expect(rows.map((row) => row.channelName)).toEqual([
        'renamed-channel',
        'renamed-channel',
      ]);
    });

    it('leaves a destination whose channel is not in the fetched list untouched', async () => {
      await seedDestination({ channelId: 'C0009', channelName: 'kept-name' });

      const refreshed = await refreshDestinationChannelNames(RELATION_ID, [
        channel('C0001', 'renamed-channel'),
      ]);

      expect(refreshed).toBe(0);
      await expect(storedNameOf('C0009')).resolves.toBe('kept-name');
    });

    it('writes once per stale destination, not once per channel in the workspace', async () => {
      // A workspace can have thousands of channels while this relation has
      // a handful of destinations, and `chat_notification_destinations` has
      // no index -- so one write per fetched channel means thousands of
      // full collection scans on every screen load. The number of writes
      // has to follow what is actually out of date instead.
      await seedDestination({ channelId: 'C0001', channelName: 'old-name' });
      await seedDestination({
        channelId: 'C0002',
        channelName: 'already-current',
      });
      const wholeWorkspace = [
        channel('C0001', 'renamed-channel'),
        channel('C0002', 'already-current'),
        ...Array.from({ length: 200 }, (_, i) =>
          channel(`C9${i}`, `unrelated-${i}`),
        ),
      ];
      const bulkWrite = vi.spyOn(ChatNotificationDestination, 'bulkWrite');

      const refreshed = await refreshDestinationChannelNames(
        RELATION_ID,
        wholeWorkspace,
      );

      expect(refreshed).toBe(1);
      expect(bulkWrite).toHaveBeenCalledTimes(1);
      const [operations] = bulkWrite.mock.calls[0];
      expect(operations).toHaveLength(1);
      await expect(storedNameOf('C0001')).resolves.toBe('renamed-channel');
      await expect(storedNameOf('C0002')).resolves.toBe('already-current');
    });

    it('writes nothing when every stored name is already current', async () => {
      await seedDestination({ channelId: 'C0001', channelName: 'general' });
      const bulkWrite = vi.spyOn(ChatNotificationDestination, 'bulkWrite');

      const refreshed = await refreshDestinationChannelNames(RELATION_ID, [
        channel('C0001', 'general'),
        channel('C0002', 'random'),
      ]);

      expect(refreshed).toBe(0);
      expect(bulkWrite).not.toHaveBeenCalled();
    });

    it("leaves another relation's destination on the same channel id untouched", async () => {
      // A channel id is only unique within one chat workspace, so a refresh
      // must never reach past the relation it was fetched for.
      await seedDestination({
        relationId: 'another-relation',
        channelName: 'other-relations-name',
      });

      await refreshDestinationChannelNames(RELATION_ID, [
        channel('C0001', 'renamed-channel'),
      ]);

      await expect(storedNameOf('C0001', 'another-relation')).resolves.toBe(
        'other-relations-name',
      );
    });
  });

  describe('loadChannelInventory', () => {
    it('refreshes the stored names as part of fetching the channel list', async () => {
      await seedDestination();
      vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
        ok: true,
        response: inventory([channel('C0001', 'renamed-channel')]),
      });

      const result = await loadChannelInventory(RELATION_ID);

      expect(result.ok).toBe(true);
      await expect(storedNameOf('C0001')).resolves.toBe('renamed-channel');
    });

    it('keeps the stored name when the channel list could not be fetched', async () => {
      await seedDestination();
      vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
        ok: false,
        reason: 'unreachable',
      });

      const result = await loadChannelInventory(RELATION_ID);

      expect(result).toEqual({ ok: false, reason: 'unreachable' });
      await expect(storedNameOf('C0001')).resolves.toBe('old-name');
    });
  });
});
