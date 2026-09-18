// Proves task 9.1's routing-level contract:
//   - every endpoint requires a real, logged-in GROWI ADMIN (not just any
//     logged-in user), same convention as `oauth-install-router.spec.ts`
//   - `GET /encryption-status` relays `describeChatKeyEncryptionConfiguration`
//   - `GET /relations` lists what `admin-service.ts` returns
//   - `GET /relations/:id/capabilities` and `.../connection-status` relay
//     `fetchCapabilities`/`fetchConnectionStatus` VERBATIM -- including a
//     field this test invents that no real platform sends yet, proving
//     there is no hardcoded per-platform allowlist silently dropping fields
//   - `GET`/`POST /relations/:id/settings` (task 9.2) round trip a saved
//     channel permission, including the 'all'/'none' values, and refuse a
//     malformed payload with 400 without touching the stored settings
//   - a save is refused for a relation that is no longer paired, and a write
//     that FAILS still answers with a real status code (409 for a concurrent
//     save, 500 otherwise) rather than leaving the request unanswered
//   - `POST /relations/:id/unpair` (Requirement 9.7) actually disconnects a
//     relation THROUGH THE HTTP ROUTE -- the state change and the deletion of
//     its keys/permissions/destinations are asserted against the database, so
//     the route being reachable is part of what is proven (calling
//     `unpairRelation` as a function is not)
//   - `POST /pairing` forwards to `submitPairingRequest` and relays whatever
//     outcome it returns, without a second encryption check duplicating
//     `pairing-service.ts`'s own
//
// and task 9.3's:
//   - `GET`/`POST /relations/:id/notification-destinations` offer the
//     channel list the proxy reports and save a destination BY IDENTIFIER,
//     refusing an id that list does not contain and ignoring any channel
//     name that arrives in the request
//   - the same channel configured on BOTH generations is reported as an
//     overlap (Requirement 12.4), decided by the name the chat service
//     reports at fetch time rather than the one stored earlier

import type { CapabilityReport, ConnectionStatusView } from '@growi/chat';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose, { type Model, Types } from 'mongoose';
import request from 'supertest';
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
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import gen1SlackSettingFactory from '~/server/models/GlobalNotificationSetting/GlobalNotificationSlackSetting';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { ChatIntegrationKey } from '../keys/models/chat-integration-key';
import { ChatNotificationDestination } from '../models/chat-notification-destination';
import { ChatRelation } from '../models/chat-relation';
import type { PairingOutcome } from '../pairing/pairing-service';
import * as pairingService from '../pairing/pairing-service';
import * as proxyClient from '../proxy-client';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import * as settingsStore from '../settings/relation-settings-store';
import { createAdminRouter } from './admin-router';

vi.mock('../pairing/pairing-service', async (importOriginal) => {
  const actual = await importOriginal<typeof pairingService>();
  return { ...actual, submitPairingRequest: vi.fn() };
});
// Kept as the real implementation (every other test here writes through a
// real transaction); spied so a single test can make the write FAIL, which
// is otherwise only reproducible by racing two saves.
vi.mock('../settings/relation-settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof settingsStore>();
  return {
    ...actual,
    writeRelationSettings: vi.fn(actual.writeRelationSettings),
  };
});
vi.mock('../proxy-client', async (importOriginal) => {
  const actual = await importOriginal<typeof proxyClient>();
  return {
    ...actual,
    fetchCapabilities: vi.fn(),
    fetchConnectionStatus: vi.fn(),
    fetchChannels: vi.fn(),
    pushSettings: vi.fn(),
  };
});

const MOUNT_PATH = '/_api/v3/chat-integration/admin';
const RELATION_ID = 'relation-under-test';

const adminUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'admin-user',
  status: 2,
  admin: true,
} as IUserHasId;

const nonAdminUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'plain-user',
  status: 2,
  admin: false,
} as IUserHasId;

/**
 * Registers Gen 1's Slack notification model (base schema + `slack`
 * discriminator) the way `setup-models.ts` does at boot, so the overlap
 * tests below read Gen 1's REAL storage rather than a stand-in: a row's
 * `slackChannels` only survives hydration once the discriminator exists,
 * which is exactly the condition production runs under.
 */
const registerGen1SlackModel = (crowi: Crowi): Model<unknown> => {
  const existing = mongoose.models.GlobalNotificationSetting;
  if (existing?.discriminators?.slack == null) {
    gen1SlackSettingFactory(crowi);
  }
  return mongoose.models.GlobalNotificationSetting as Model<unknown>;
};

const gen1SlackModel = (): Model<{
  isEnabled: boolean;
  triggerPath: string;
  triggerEvents: string[];
  slackChannels: string;
}> =>
  mongoose.models.GlobalNotificationSetting.discriminators?.slack as Model<{
    isEnabled: boolean;
    triggerPath: string;
    triggerEvents: string[];
    slackChannels: string;
  }>;

const buildMockCrowi = (): Crowi => {
  const crowi = mock<Crowi>();
  crowi.models = { GlobalNotificationSetting: registerGen1SlackModel(crowi) };
  return crowi;
};

const buildApp = (injectUser?: IUserHasId): Express => {
  const responseHelpers: { response: Record<string, unknown> } = {
    response: {},
  };
  addCustomFunctionToResponse(responseHelpers);

  const app = express();
  app.use(express.json());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    Object.assign(res, responseHelpers.response);
    next();
  });
  if (injectUser != null) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: IUserHasId }).user = injectUser;
      next();
    });
  }
  app.use(MOUNT_PATH, createAdminRouter(buildMockCrowi()));
  return app;
};

const seedRelation = () =>
  ChatRelation.create({
    relationId: RELATION_ID,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: 'workspace-0001',
    workspaceName: 'Test Workspace',
    label: null,
    state: 'active',
    settingsVersion: 0,
    createdAt: new Date(),
  });

describe('admin-router', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_admin_router',
    ));
    await ChatChannelPermission.init();
    registerGen1SlackModel(mock<Crowi>());
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatRelation.deleteMany({});
    await ChatChannelPermission.deleteMany({});
    await ChatNotificationDestination.deleteMany({});
    await ChatIntegrationKey.deleteMany({});
    await gen1SlackModel().deleteMany({});
    vi.clearAllMocks();
    vi.mocked(proxyClient.pushSettings).mockResolvedValue({
      ok: true,
      response: undefined,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('login / admin requirement (all endpoints)', () => {
    it('refuses GET /relations without a logged-in session', async () => {
      const app = buildApp();
      const response = await request(app).get(`${MOUNT_PATH}/relations`);
      expect(response.status).not.toBe(200);
    });

    it('refuses GET /relations for a logged-in NON-admin user', async () => {
      const app = buildApp(nonAdminUser);
      const response = await request(app).get(`${MOUNT_PATH}/relations`);
      expect(response.status).not.toBe(200);
    });

    it('refuses POST /pairing for a logged-in NON-admin user', async () => {
      const app = buildApp(nonAdminUser);
      const response = await request(app).post(`${MOUNT_PATH}/pairing`).send({
        registrationCode: 'code',
        proxyUri: 'https://proxy.example.test',
        growiUri: 'https://growi.example.test',
        growiLabel: 'My GROWI',
      });
      expect(response.status).not.toBe(200);
      expect(pairingService.submitPairingRequest).not.toHaveBeenCalled();
    });
  });

  describe('GET /encryption-status', () => {
    it("relays describeChatKeyEncryptionConfiguration's verdict for an admin", async () => {
      const app = buildApp(adminUser);
      const response = await request(app).get(
        `${MOUNT_PATH}/encryption-status`,
      );
      expect(response.status).toBe(200);
      // Test env carries no CHAT_INTEGRATION_KEY_ENCRYPTION_KEY.
      expect(response.body.configured).toBe(false);
      expect(response.body.reason).toBe('unset');
    });
  });

  describe('GET /relations', () => {
    it('lists relations for an admin', async () => {
      await seedRelation();
      const app = buildApp(adminUser);

      const response = await request(app).get(`${MOUNT_PATH}/relations`);

      expect(response.status).toBe(200);
      expect(response.body.relations).toHaveLength(1);
      expect(response.body.relations[0].relationId).toBe(RELATION_ID);
      expect(response.body.relations[0].workspaceName).toBe('Test Workspace');
    });
  });

  describe('GET /relations/:relationId/capabilities', () => {
    it('relays CapabilityReport verbatim, including a field no known platform sends yet', async () => {
      // An invented capability/level combination proves the router does not
      // filter or branch on known fields -- it passes through whatever the
      // proxy answers with, exactly as this task's own text requires.
      const report: CapabilityReport = {
        platforms: [
          {
            platform: 'slack',
            capabilities: [
              {
                capability: 'slashCommand',
                level: 'none',
                substitute: 'mention',
              },
              {
                capability: 'never-seen-before-capability',
                level: 'degraded',
                substitute: 'a made-up workaround',
              },
            ],
          },
        ],
      };
      vi.mocked(proxyClient.fetchCapabilities).mockResolvedValue({
        ok: true,
        response: report,
      });
      const app = buildApp(adminUser);

      const response = await request(app).get(
        `${MOUNT_PATH}/relations/${RELATION_ID}/capabilities`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(report);
      expect(proxyClient.fetchCapabilities).toHaveBeenCalledWith(RELATION_ID);
    });

    it('answers 502 when the proxy call fails', async () => {
      vi.mocked(proxyClient.fetchCapabilities).mockResolvedValue({
        ok: false,
        reason: 'unreachable',
      });
      const app = buildApp(adminUser);

      const response = await request(app).get(
        `${MOUNT_PATH}/relations/${RELATION_ID}/capabilities`,
      );

      expect(response.status).toBe(502);
    });
  });

  describe('GET /relations/:relationId/connection-status', () => {
    it('relays ConnectionStatusView verbatim', async () => {
      const view: ConnectionStatusView = {
        platform: 'slack',
        health: 'connected',
        since: '2026-01-01T00:00:00.000Z',
      };
      vi.mocked(proxyClient.fetchConnectionStatus).mockResolvedValue({
        ok: true,
        response: view,
      });
      const app = buildApp(adminUser);

      const response = await request(app).get(
        `${MOUNT_PATH}/relations/${RELATION_ID}/connection-status`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(view);
    });
  });

  describe('channel permission settings (task 9.2)', () => {
    const settingsPath = `${MOUNT_PATH}/relations/${RELATION_ID}/settings`;

    it('refuses the save for a logged-in NON-admin user', async () => {
      await seedRelation();
      const app = buildApp(nonAdminUser);

      const response = await request(app)
        .post(settingsPath)
        .send({
          channelPermissions: [
            { commandName: 'create-page', allowedChannels: 'all' },
          ],
        });

      expect(response.status).not.toBe(200);
      expect(await ChatChannelPermission.countDocuments({})).toBe(0);
    });

    it('reads back what was saved, for all three allowedChannels forms', async () => {
      await seedRelation();
      const app = buildApp(adminUser);
      const channelPermissions = [
        { commandName: 'create-page', allowedChannels: 'all' },
        { commandName: 'keep', allowedChannels: 'none' },
        { commandName: 'search', allowedChannels: ['C0001', 'C0002'] },
      ];

      const saved = await request(app)
        .post(settingsPath)
        .send({ channelPermissions });

      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({
        status: 'saved',
        version: 1,
        push: { ok: true },
      });

      const read = await request(app).get(settingsPath);

      expect(read.status).toBe(200);
      expect(read.body.version).toBe(1);
      expect(read.body.settings).toEqual({
        relationId: RELATION_ID,
        channelPermissions: expect.arrayContaining(channelPermissions),
      });
    });

    it('reports a failed push as a successful save the proxy has yet to hear about', async () => {
      await seedRelation();
      vi.mocked(proxyClient.pushSettings).mockResolvedValue({
        ok: false,
        reason: 'unreachable',
      });
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(settingsPath)
        .send({
          channelPermissions: [
            { commandName: 'search', allowedChannels: 'all' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'saved',
        version: 1,
        push: { ok: false, reason: 'unreachable' },
      });
      const read = await request(app).get(settingsPath);
      expect(read.body.settings.channelPermissions).toEqual([
        { commandName: 'search', allowedChannels: 'all' },
      ]);
    });

    it('answers 400 for a malformed payload, changing nothing', async () => {
      await seedRelation();
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(settingsPath)
        .send({
          channelPermissions: [
            { commandName: 'search', allowedChannels: 'everything' },
          ],
        });

      expect(response.status).toBe(400);
      expect(proxyClient.pushSettings).not.toHaveBeenCalled();
      const read = await request(app).get(settingsPath);
      expect(read.body.version).toBe(0);
      expect(read.body.settings.channelPermissions).toEqual([]);
    });

    it('answers 404 for a relation that is no longer paired', async () => {
      await seedRelation();
      await ChatRelation.updateOne(
        { relationId: RELATION_ID },
        { $set: { state: 'unpaired', unpairedAt: new Date() } },
      );
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(settingsPath)
        .send({
          channelPermissions: [
            { commandName: 'search', allowedChannels: 'all' },
          ],
        });

      expect(response.status).toBe(404);
      // `unpairRelation` deleted this relation's rows deliberately; the
      // save must not put them back.
      expect(await ChatChannelPermission.countDocuments({})).toBe(0);
      expect(proxyClient.pushSettings).not.toHaveBeenCalled();
    });

    // A rejected promise inside an `async` Express 4 handler produces NO
    // response at all -- the request hangs until the client gives up. Both
    // tests below assert a real status code arrives, which is what a hang
    // cannot produce.
    describe('a write that fails instead of answering', () => {
      it('answers 409 when a concurrent save refused the transaction', async () => {
        await seedRelation();
        // What MongoDB actually raises when two transactions bump the same
        // `chat_relations` document at once.
        const writeConflict = Object.assign(new Error('WriteConflict'), {
          code: 112,
          errorLabels: ['TransientTransactionError'],
        });
        vi.mocked(settingsStore.writeRelationSettings).mockRejectedValueOnce(
          writeConflict,
        );
        const app = buildApp(adminUser);

        const response = await request(app)
          .post(settingsPath)
          .send({
            channelPermissions: [
              { commandName: 'search', allowedChannels: 'all' },
            ],
          });

        expect(response.status).toBe(409);
        expect(proxyClient.pushSettings).not.toHaveBeenCalled();
      });

      it('answers 500 when the write fails for any other reason', async () => {
        await seedRelation();
        vi.mocked(settingsStore.writeRelationSettings).mockRejectedValueOnce(
          new Error('the database went away'),
        );
        const app = buildApp(adminUser);

        const response = await request(app)
          .post(settingsPath)
          .send({
            channelPermissions: [
              { commandName: 'search', allowedChannels: 'all' },
            ],
          });

        expect(response.status).toBe(500);
        expect(proxyClient.pushSettings).not.toHaveBeenCalled();
      });
    });

    it('answers 404 for a relation that does not exist', async () => {
      const app = buildApp(adminUser);

      const saveResponse = await request(app)
        .post(`${MOUNT_PATH}/relations/no-such-relation/settings`)
        .send({
          channelPermissions: [
            { commandName: 'search', allowedChannels: 'all' },
          ],
        });
      const readResponse = await request(app).get(
        `${MOUNT_PATH}/relations/no-such-relation/settings`,
      );

      expect(saveResponse.status).toBe(404);
      expect(readResponse.status).toBe(404);
      expect(proxyClient.pushSettings).not.toHaveBeenCalled();
    });
  });

  describe('notification destinations (task 9.3)', () => {
    const DESTINATIONS_PATH = `${MOUNT_PATH}/relations/${RELATION_ID}/notification-destinations`;

    const stubChannels = (
      channels: ReadonlyArray<{ channelId: string; channelName: string }>,
    ) => {
      vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
        ok: true,
        response: {
          channels: channels.map((channel) => ({
            platform: 'slack',
            isPrivate: false,
            ...channel,
          })),
        },
      });
    };

    const seedGen1SlackSetting = (slackChannels: string, isEnabled = true) =>
      gen1SlackModel().create({
        isEnabled,
        triggerPath: '/*',
        triggerEvents: ['pageCreate'],
        slackChannels,
      });

    const seedGen2Destination = (
      overrides: Partial<{ channelId: string; channelName: string }> = {},
    ) =>
      ChatNotificationDestination.create({
        relationId: RELATION_ID,
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
        ...overrides,
      });

    it('offers the channels the chat service reports, so a destination is chosen by identifier', async () => {
      await seedRelation();
      stubChannels([
        { channelId: 'C0001', channelName: 'general' },
        { channelId: 'C0002', channelName: 'random' },
      ]);
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.status).toBe(200);
      expect(response.body.channels).toEqual([
        {
          platform: 'slack',
          channelId: 'C0001',
          channelName: 'general',
          isPrivate: false,
        },
        {
          platform: 'slack',
          channelId: 'C0002',
          channelName: 'random',
          isPrivate: false,
        },
      ]);
      expect(response.body.channelsUnavailable).toBeNull();
    });

    it('warns about a channel that is a destination for BOTH Gen 1 and Gen 2', async () => {
      // This is task 9.3's own completion condition: the same channel is
      // configured on both generations, so one page event would be posted
      // to it twice.
      await seedRelation();
      await seedGen1SlackSetting('general, random');
      await seedGen2Destination({ channelId: 'C0001', channelName: 'general' });
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.status).toBe(200);
      expect(response.body.overlaps).toEqual([
        { channelId: 'C0001', channelName: 'general' },
      ]);
    });

    it('does not warn when Gen 1 posts to different channels', async () => {
      await seedRelation();
      await seedGen1SlackSetting('announcements');
      await seedGen2Destination({ channelId: 'C0001', channelName: 'general' });
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.status).toBe(200);
      expect(response.body.overlaps).toEqual([]);
    });

    it('decides the warning by the name the chat service reports NOW, not the stored one', async () => {
      // The channel was saved as `general` and has since been renamed to
      // `announcements`, which is where Gen 1 posts. Without the refresh
      // that the channel-list fetch performs, the comparison would run on
      // the abandoned name and stay silent.
      await seedRelation();
      await seedGen1SlackSetting('announcements');
      await seedGen2Destination({ channelId: 'C0001', channelName: 'general' });
      stubChannels([{ channelId: 'C0001', channelName: 'announcements' }]);
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.status).toBe(200);
      expect(response.body.overlaps).toEqual([
        { channelId: 'C0001', channelName: 'announcements' },
      ]);
      expect(response.body.destinations[0].channelName).toBe('announcements');
    });

    it('still shows the configured destinations when the channel list cannot be fetched', async () => {
      await seedRelation();
      await seedGen2Destination();
      vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
        ok: false,
        reason: 'unreachable',
      });
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.status).toBe(200);
      expect(response.body.destinations).toHaveLength(1);
      expect(response.body.channels).toEqual([]);
      expect(response.body.channelsUnavailable).toBe('unreachable');
    });

    it('says the overlap check could not be run on current names when the channel list is unavailable', async () => {
      // The names were not refreshed, so "no overlap" here means "no
      // overlap according to names that may already be abandoned". The
      // screen has to be able to tell the operator that much -- otherwise
      // silence reads as confirmation.
      await seedRelation();
      await seedGen2Destination();
      vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
        ok: false,
        reason: 'unreachable',
      });
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.body.overlapsMayBeStale).toBe(true);
    });

    it('says the overlap check ran on current names when the channel list was fetched', async () => {
      await seedRelation();
      await seedGen2Destination();
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app).get(DESTINATIONS_PATH);

      expect(response.body.overlapsMayBeStale).toBe(false);
    });

    it('saves a destination by channel identifier, taking the name from the fetched list', async () => {
      await seedRelation();
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C0001',
          pathPattern: '/docs/*',
          triggerEvents: ['pageCreate', 'pageEdit'],
        });

      expect(response.status).toBe(200);
      const stored = await ChatNotificationDestination.find({
        relationId: RELATION_ID,
      });
      expect(stored).toHaveLength(1);
      expect(stored[0].channelId).toBe('C0001');
      expect(stored[0].channelName).toBe('general');
      expect(stored[0].pathPattern).toBe('/docs/*');
      expect(stored[0].triggerEvents).toEqual(['pageCreate', 'pageEdit']);
    });

    it('ignores a channel name sent in the request, keeping the one the chat service reports', async () => {
      // Requirement 2.2: the identifier is what an administrator picks. A
      // name arriving in the payload must not become what GROWI stores,
      // otherwise the overlap warning could be steered by the request.
      await seedRelation();
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C0001',
          channelName: 'something-else',
          pathPattern: '/*',
          triggerEvents: ['pageCreate'],
        });

      expect(response.status).toBe(200);
      const stored = await ChatNotificationDestination.findOne({
        relationId: RELATION_ID,
      });
      expect(stored?.channelName).toBe('general');
    });

    it('replaces the events of a destination saved again for the same channel and path', async () => {
      await seedRelation();
      await seedGen2Destination({ channelId: 'C0001', channelName: 'general' });
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C0001',
          pathPattern: '/*',
          triggerEvents: ['pageDelete'],
        });

      const stored = await ChatNotificationDestination.find({
        relationId: RELATION_ID,
      });
      expect(stored).toHaveLength(1);
      expect(stored[0].triggerEvents).toEqual(['pageDelete']);
    });

    it('refuses a channel id the chat service does not report', async () => {
      await seedRelation();
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C-not-a-real-channel',
          pathPattern: '/*',
          triggerEvents: ['pageCreate'],
        });

      expect(response.status).toBe(400);
      expect(await ChatNotificationDestination.countDocuments({})).toBe(0);
    });

    it('refuses an unknown trigger event rather than storing a destination that never fires', async () => {
      await seedRelation();
      stubChannels([{ channelId: 'C0001', channelName: 'general' }]);
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C0001',
          pathPattern: '/*',
          triggerEvents: ['pageExploded'],
        });

      expect(response.status).toBe(400);
      expect(await ChatNotificationDestination.countDocuments({})).toBe(0);
    });

    it('answers 404 for a relation that is not paired, without asking the proxy', async () => {
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(
          `${MOUNT_PATH}/relations/no-such-relation/notification-destinations`,
        )
        .send({
          channelId: 'C0001',
          pathPattern: '/*',
          triggerEvents: ['pageCreate'],
        });

      expect(response.status).toBe(404);
      expect(proxyClient.fetchChannels).not.toHaveBeenCalled();
    });

    it('answers 502 when the channel list cannot be fetched, so no id can be confirmed', async () => {
      await seedRelation();
      vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
        ok: false,
        reason: 'unreachable',
      });
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C0001',
          pathPattern: '/*',
          triggerEvents: ['pageCreate'],
        });

      expect(response.status).toBe(502);
      expect(await ChatNotificationDestination.countDocuments({})).toBe(0);
    });

    it('refuses both endpoints for a logged-in NON-admin user', async () => {
      const app = buildApp(nonAdminUser);

      const readResponse = await request(app).get(DESTINATIONS_PATH);
      const saveResponse = await request(app)
        .post(DESTINATIONS_PATH)
        .send({
          channelId: 'C0001',
          pathPattern: '/*',
          triggerEvents: ['pageCreate'],
        });

      expect(readResponse.status).not.toBe(200);
      expect(saveResponse.status).not.toBe(200);
      expect(await ChatNotificationDestination.countDocuments({})).toBe(0);
    });
  });

  // Every assertion below goes through the HTTP route, on purpose: this
  // feature's end-to-end test called `unpairRelation()` as a function, which
  // is why the missing route went unnoticed -- a green function-level test
  // says nothing about whether an administrator can reach the operation.
  describe('POST /relations/:relationId/unpair (Requirement 9.7)', () => {
    const unpairPath = `${MOUNT_PATH}/relations/${RELATION_ID}/unpair`;

    /**
     * A `side: 'peer'` key (the proxy's PUBLIC key) rather than an own-side
     * one: `unpairRelation` deletes by `relationId` regardless of side, and
     * the own-side schema validator would refuse anything that is not a real
     * `encryptChatKeyForStorage` envelope -- which needs an encryption key
     * the test environment deliberately does not configure.
     */
    const seedRelationWithEverything = async () => {
      await seedRelation();
      await ChatIntegrationKey.create({
        relationId: RELATION_ID,
        side: 'peer',
        keyId: 'peer-key-1',
        key: '{"kty":"OKP","crv":"Ed25519","x":"not-a-secret"}',
        validFrom: new Date(),
        revokedAt: null,
      });
      await ChatChannelPermission.create({
        relationId: RELATION_ID,
        commandName: 'search',
        allowedChannels: 'all',
      });
      await ChatNotificationDestination.create({
        relationId: RELATION_ID,
        platform: 'slack',
        channelId: 'C0001',
        channelName: 'general',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      });
    };

    it('marks the relation unpaired and removes its keys, permissions and destinations', async () => {
      await seedRelationWithEverything();
      const app = buildApp(adminUser);

      const response = await request(app).post(unpairPath);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'unpaired' });

      const relation = await ChatRelation.findOne({
        relationId: RELATION_ID,
      }).lean();
      // The row itself must SURVIVE: `platform`/`workspaceId` are the only
      // things a later re-pairing recognises the same workspace by, and
      // `unpairedAt` is what the 90-day sweep and the account-link
      // inheritance both read.
      expect(relation?.state).toBe('unpaired');
      expect(relation?.unpairedAt).toBeInstanceOf(Date);
      expect(relation?.workspaceId).toBe('workspace-0001');

      expect(
        await ChatIntegrationKey.countDocuments({ relationId: RELATION_ID }),
      ).toBe(0);
      expect(
        await ChatChannelPermission.countDocuments({
          relationId: RELATION_ID,
        }),
      ).toBe(0);
      expect(
        await ChatNotificationDestination.countDocuments({
          relationId: RELATION_ID,
        }),
      ).toBe(0);
    });

    it('refuses the unpair for a logged-in NON-admin user, leaving the relation active', async () => {
      await seedRelationWithEverything();
      const app = buildApp(nonAdminUser);

      const response = await request(app).post(unpairPath);

      // `adminRequired` redirects a logged-in non-admin rather than
      // answering 403 (matches this router's other admin-only routes).
      expect(response.status).toBe(302);
      const relation = await ChatRelation.findOne({
        relationId: RELATION_ID,
      }).lean();
      expect(relation?.state).toBe('active');
      expect(
        await ChatIntegrationKey.countDocuments({ relationId: RELATION_ID }),
      ).toBe(1);
    });

    it('refuses the unpair without a logged-in session', async () => {
      await seedRelation();
      const app = buildApp();

      const response = await request(app).post(unpairPath);

      expect(response.status).toBe(403);
      const relation = await ChatRelation.findOne({
        relationId: RELATION_ID,
      }).lean();
      expect(relation?.state).toBe('active');
    });

    it('answers 200 for a relation that is already unpaired, without moving unpairedAt', async () => {
      // Idempotent rather than an error: the row's state is decided by
      // `unpairRelation` alone (it filters its own write on `state:
      // 'active'`), and a second check here would be a second place that
      // could drift from it. `unpairedAt` must not be pushed forward either
      // -- the 90-day sweep counts from the FIRST disconnection.
      await seedRelationWithEverything();
      const app = buildApp(adminUser);

      const first = await request(app).post(unpairPath);
      // Backdated on purpose: two POSTs in the same millisecond would write
      // indistinguishable timestamps, so an unchanged value would prove
      // nothing. A far-past date is only preserved if the second unpair
      // really did skip the write.
      const firstUnpairedAt = new Date('2020-01-01T00:00:00.000Z');
      await ChatRelation.updateOne(
        { relationId: RELATION_ID },
        { $set: { unpairedAt: firstUnpairedAt } },
      );

      const second = await request(app).post(unpairPath);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const relation = await ChatRelation.findOne({
        relationId: RELATION_ID,
      }).lean();
      expect(relation?.state).toBe('unpaired');
      expect(relation?.unpairedAt?.getTime()).toBe(firstUnpairedAt.getTime());
    });

    it('answers 404 for a relation that does not exist', async () => {
      const app = buildApp(adminUser);

      const response = await request(app).post(
        `${MOUNT_PATH}/relations/no-such-relation/unpair`,
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /pairing', () => {
    it('answers 400 when a required field is missing', async () => {
      const app = buildApp(adminUser);

      const response = await request(app).post(`${MOUNT_PATH}/pairing`).send({
        registrationCode: 'code',
      });

      expect(response.status).toBe(400);
      expect(pairingService.submitPairingRequest).not.toHaveBeenCalled();
    });

    it('forwards to submitPairingRequest with the logged-in admin as createdBy, and relays its outcome', async () => {
      const outcome: PairingOutcome = {
        status: 'paired',
        relationId: 'relation-new',
        inheritance: { inheritedFrom: null, movedCount: 0, discardedCount: 0 },
      };
      vi.mocked(pairingService.submitPairingRequest).mockResolvedValue(outcome);
      const app = buildApp(adminUser);

      const response = await request(app).post(`${MOUNT_PATH}/pairing`).send({
        registrationCode: 'the-code',
        proxyUri: 'https://proxy.example.test',
        growiUri: 'https://growi.example.test',
        growiLabel: 'My GROWI',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(outcome);
      expect(pairingService.submitPairingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          registrationCode: 'the-code',
          proxyUri: 'https://proxy.example.test',
          growiUri: 'https://growi.example.test',
          growiLabel: 'My GROWI',
        }),
      );
      const calledWith = vi.mocked(pairingService.submitPairingRequest).mock
        .calls[0][0];
      expect(calledWith.createdBy.toString()).toBe(adminUser._id);
    });

    it('relays a "key-encryption-unconfigured" outcome without a second check duplicating pairing-service', async () => {
      const outcome: PairingOutcome = { status: 'key-encryption-unconfigured' };
      vi.mocked(pairingService.submitPairingRequest).mockResolvedValue(outcome);
      const app = buildApp(adminUser);

      const response = await request(app).post(`${MOUNT_PATH}/pairing`).send({
        registrationCode: 'the-code',
        proxyUri: 'https://proxy.example.test',
        growiUri: 'https://growi.example.test',
        growiLabel: 'My GROWI',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(outcome);
    });
  });
});
