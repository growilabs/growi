// Proves task 9.2's admin-boundary contract:
//
//   - the settings the proxy is pushed are the settings that were just
//     committed, at the version that is now in the database -- the push
//     happens AFTER the commit, never before (a push of a version that
//     never committed would make the proxy discard the real save that
//     follows it)
//   - a failed push does NOT fail the save. The proxy comes and fetches it
//     through `settings-pull` (task 3.5) instead, so refusing the save
//     would throw away a change that is already durable
//   - a malformed payload is refused BEFORE anything is written, naming
//     what was wrong
//   - a setting saved through this path is what the COMMAND ENDPOINT then
//     judges the next command by -- this task's own completion condition
//     (see the describe block below for why neither half proves it alone)
//
// `pushSettings` is mocked because it is the network boundary; everything
// on this side of it (the transaction, the version, the stored rows) runs
// against a real MongoDB replica set.

import type { CommandRequest } from '@growi/chat';
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
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';

import { createCommandEndpoint } from '../command/command-endpoint';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { ChatRelation } from '../models/chat-relation';
import * as proxyClient from '../proxy-client';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import { readRelationSettings } from '../settings/relation-settings-store';
import { saveRelationSettings } from './save-relation-settings';

vi.mock('../proxy-client', async (importOriginal) => {
  const actual = await importOriginal<typeof proxyClient>();
  return { ...actual, pushSettings: vi.fn() };
});

const RELATION_ID = 'relation-under-test';
const INITIAL_VERSION = 3;

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

describe('saveRelationSettings', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_save_relation_settings',
    ));
    await ChatChannelPermission.init();
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(proxyClient.pushSettings).mockResolvedValue({
      ok: true,
      response: undefined,
    });
    await ChatRelation.deleteMany({});
    await ChatChannelPermission.deleteMany({});
    await seedRelation();
  });

  it('pushes the committed settings at the committed version', async () => {
    let versionVisibleInDbAtPushTime: number | undefined;
    vi.mocked(proxyClient.pushSettings).mockImplementation(async () => {
      // Reading the relation from inside the push proves the ordering: if
      // the push ran before the commit, this would still see the old
      // version.
      versionVisibleInDbAtPushTime = (
        await ChatRelation.findOne({ relationId: RELATION_ID }).lean()
      )?.settingsVersion;
      return { ok: true, response: undefined };
    });

    const outcome = await saveRelationSettings(RELATION_ID, [
      { commandName: 'create-page', allowedChannels: 'all' },
      { commandName: 'keep', allowedChannels: ['C0001'] },
    ]);

    expect(outcome).toEqual({
      status: 'saved',
      version: INITIAL_VERSION + 1,
      push: { ok: true },
    });
    expect(versionVisibleInDbAtPushTime).toBe(INITIAL_VERSION + 1);
    expect(proxyClient.pushSettings).toHaveBeenCalledWith(RELATION_ID, {
      version: INITIAL_VERSION + 1,
      settings: {
        relationId: RELATION_ID,
        channelPermissions: [
          { commandName: 'create-page', allowedChannels: 'all' },
          { commandName: 'keep', allowedChannels: ['C0001'] },
        ],
      },
    });
  });

  it("keeps the save when the push is refused -- the proxy's settings-pull picks it up later", async () => {
    vi.mocked(proxyClient.pushSettings).mockResolvedValue({
      ok: false,
      reason: 'unreachable',
    });

    const outcome = await saveRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: 'none' },
    ]);

    expect(outcome).toEqual({
      status: 'saved',
      version: INITIAL_VERSION + 1,
      push: { ok: false, reason: 'unreachable' },
    });
    const read = await readRelationSettings(RELATION_ID);
    expect(read?.version).toBe(INITIAL_VERSION + 1);
    expect(read?.settings.channelPermissions).toEqual([
      { commandName: 'search', allowedChannels: 'none' },
    ]);
  });

  it('keeps the save when the push throws instead of answering', async () => {
    vi.mocked(proxyClient.pushSettings).mockRejectedValue(
      new Error('socket hang up'),
    );

    const outcome = await saveRelationSettings(RELATION_ID, [
      { commandName: 'search', allowedChannels: 'all' },
    ]);

    expect(outcome.status).toBe('saved');
    expect((await readRelationSettings(RELATION_ID))?.version).toBe(
      INITIAL_VERSION + 1,
    );
  });

  it('does not push anything for an unknown relation', async () => {
    const outcome = await saveRelationSettings('no-such-relation', [
      { commandName: 'search', allowedChannels: 'all' },
    ]);

    expect(outcome).toEqual({ status: 'relation-not-found' });
    expect(proxyClient.pushSettings).not.toHaveBeenCalled();
  });

  // Task 9.2's own completion condition: 設定を変えると次の実行から反映される
  // ことが試験で示される. Neither half proves this alone -- a store round trip
  // shows the save reads back, and the command endpoint's own tests drive
  // hand-written rows. Only running BOTH real halves catches the writer
  // (`toStoredAllowedChannels`) and the reader (`checkChannelPermission` via
  // `toWireAllowedChannels`) drifting apart, which is precisely the bug this
  // task's shared encoding module exists to prevent.
  //
  // `help` is the command used because it needs nothing from Crowi beyond
  // the permission judgment, and the permission judgment is what is under
  // test; a fresh `requestId` per execution keeps the endpoint's own
  // idempotent replay (Requirement 10.4) from answering the second run with
  // the first run's response.
  describe("a changed setting takes effect on the command endpoint's next execution", () => {
    const CHANNEL = {
      platform: 'slack',
      channelId: 'C0GENERAL',
      channelName: 'general',
      isPrivate: false,
    } as const;

    const helpRequest = (
      requestId: string,
      channelId: string = CHANNEL.channelId,
    ): CommandRequest => ({
      relationId: RELATION_ID,
      op: 'command',
      requestId,
      actor: {
        platform: 'slack',
        accountId: 'U0ACCOUNT',
        displayName: 'Chatty Person',
      },
      channel: { ...CHANNEL, channelId },
      kind: 'help',
    });

    const runHelp = (requestId: string, channelId?: string) =>
      createCommandEndpoint(mock<Crowi>()).handle(
        helpRequest(requestId, channelId),
      );

    beforeEach(async () => {
      await ChatProcessedRequest.deleteMany({});
    });

    it("refuses the command after 'none' is saved, and allows it after the channel is listed", async () => {
      await saveRelationSettings(RELATION_ID, [
        { commandName: 'help', allowedChannels: 'none' },
      ]);

      expect(await runHelp('req-after-none')).toEqual({
        kind: 'error',
        code: 'not-permitted-in-channel',
        message: expect.any(String),
      });

      await saveRelationSettings(RELATION_ID, [
        { commandName: 'help', allowedChannels: [CHANNEL.channelId] },
      ]);

      expect((await runHelp('req-after-listed')).kind).toBe('help');
    });

    it("allows the command from a channel nobody listed after 'all' is saved", async () => {
      await saveRelationSettings(RELATION_ID, [
        { commandName: 'help', allowedChannels: [CHANNEL.channelId] },
      ]);

      expect((await runHelp('req-other-channel', 'C0NEVER-LISTED')).kind).toBe(
        'error',
      );

      await saveRelationSettings(RELATION_ID, [
        { commandName: 'help', allowedChannels: 'all' },
      ]);

      expect(
        (await runHelp('req-other-channel-all', 'C0NEVER-LISTED')).kind,
      ).toBe('help');
    });
  });

  describe('refuses a malformed payload without writing or pushing', () => {
    const malformed: ReadonlyArray<[string, unknown]> = [
      ['not an array at all', { commandName: 'search' }],
      [
        'a command neither side knows',
        [{ commandName: 'nuke', allowedChannels: 'all' }],
      ],
      [
        'an allowedChannels value that is neither a list nor all/none',
        [{ commandName: 'search', allowedChannels: 'everything' }],
      ],
      [
        'a channel id that is not a string',
        [{ commandName: 'search', allowedChannels: [42] }],
      ],
      [
        'two rows for the same command',
        [
          { commandName: 'search', allowedChannels: 'all' },
          { commandName: 'search', allowedChannels: 'none' },
        ],
      ],
    ];

    it.each(malformed)('%s', async (_label, channelPermissions) => {
      const outcome = await saveRelationSettings(
        RELATION_ID,
        channelPermissions,
      );

      expect(outcome.status).toBe('invalid-settings');
      expect(proxyClient.pushSettings).not.toHaveBeenCalled();
      expect((await readRelationSettings(RELATION_ID))?.version).toBe(
        INITIAL_VERSION,
      );
      expect(await ChatChannelPermission.countDocuments({})).toBe(0);
    });
  });
});
