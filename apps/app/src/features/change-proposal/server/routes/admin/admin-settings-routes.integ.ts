import type { IUserHasId } from '@growi/core';
import express from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import type { ConfigKey } from '~/server/service/config-manager/config-definition';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalSettingsView } from '../../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../../services/change-proposal-service';
import { createApplierTestKit } from '../../services/proposal-applier.test-kit';
import { readChangeProposalSettings } from '../../services/settings';
import { createChangeProposalAdminRouter } from '.';

const TEST_IP = '10.0.0.172';
const PREFIX = '/cp-admin-settings-routes-integ';
const MOUNT_PATH = '/_api/v3/change-proposal-settings';
const ADMIN_USERNAME = 'cpAdminSettingsAdmin';
// Long enough for the fire-and-forget activity writes to land if they were going to.
const ABSENCE_WAIT_MS = 500;

const SETTING_KEYS: readonly ConfigKey[] = [
  'app:changeProposalEnabled',
  'changeProposal:isEditEnabled',
  'changeProposal:isCreateEnabled',
  'changeProposal:isMoveEnabled',
  'changeProposal:autoApplyPolicy',
  'changeProposal:maxOperationsPerProposal',
  'changeProposal:maxProposalsPerUserPerDay',
  'changeProposal:perPageNotificationsEnabled',
];

// Without mutating process.env: the env-only group itself is covered by config-definition.spec.
const fixSettingsByEnvVars = (): void => {
  const realGetConfig = configManager.getConfig.bind(configManager);
  vi.spyOn(configManager, 'getConfig').mockImplementation(
    // WHY: a non-generic implementation cannot satisfy getConfig's generic return type.
    (key, source) =>
      (key === 'env:useOnlyEnvVars:changeProposal'
        ? true
        : realGetConfig(key, source)) as never,
  );
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('change-proposal admin settings routes', () => {
  let crowi: Crowi;
  let app: express.Application;
  let admin: HydratedDocument<IUserHasId>;
  let currentUser: IUserHasId | undefined;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpAdminSettingsRequester',
      subscriber: 'cpAdminSettingsSubscriber',
      other: 'cpAdminSettingsOther',
    },
  });
  const { users } = kit;

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const get = () =>
    request(app).get(MOUNT_PATH).set('X-Forwarded-For', TEST_IP);

  const put = (body: object) =>
    request(app).put(MOUNT_PATH).set('X-Forwarded-For', TEST_IP).send(body);

  const activities = () =>
    prisma.activities.findMany({
      where: { ip: TEST_IP, endpoint: MOUNT_PATH },
    });

  // A refused update leaves only the attempt row, never the settings update action.
  const expectOnlyAnUnsettledAttempt = async () => {
    await vi.waitFor(
      async () => {
        if ((await activities()).length === 0) {
          throw new Error('no activity yet');
        }
      },
      { timeout: 5000, interval: 50 },
    );
    await sleep(ABSENCE_WAIT_MS);
    expect((await activities()).map((row) => row.action)).toEqual([
      SupportedAction.ACTION_UNSETTLED,
    ]);
  };

  const resetSettings = async () => {
    await configManager.updateConfigs(
      Object.fromEntries(SETTING_KEYS.map((key) => [key, undefined])),
      { removeIfUndefined: true },
    );
    await configManager.updateConfigs({ 'app:changeProposalEnabled': true });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });
    admin = await mongoose.model<IUserHasId>('User').create({
      name: ADMIN_USERNAME,
      username: ADMIN_USERNAME,
      email: `${ADMIN_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      admin: true,
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app = express();
    // Activity rows carry req.ip; the suite's rows are found and removed by TEST_IP.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    app.use(
      MOUNT_PATH,
      createChangeProposalAdminRouter(crowi, {
        service,
      }),
    );
  }, 120_000);

  beforeEach(async () => {
    currentUser = undefined;
    await resetSettings();
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await configManager.updateConfigs(
      {
        ...Object.fromEntries(SETTING_KEYS.map((key) => [key, undefined])),
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
    await mongoose.model('User').deleteMany({ username: ADMIN_USERNAME });
    await kit.tearDown();
  }, 60_000);

  describe('GET /', () => {
    it('returns the current settings to an admin', async () => {
      await configManager.updateConfigs({
        'changeProposal:isMoveEnabled': false,
        'changeProposal:autoApplyPolicy': 'own-pages',
        'changeProposal:maxOperationsPerProposal': 30,
      });
      asUser(admin);

      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body.settings).toEqual({
        isEnabled: true,
        enabledOperationTypes: ['edit', 'create'],
        autoApplyPolicy: 'own-pages',
        maxOperationsPerProposal: 30,
        maxProposalsPerUserPerDay: null,
        perPageNotificationsEnabled: false,
        useOnlyEnvVars: false,
      } satisfies ChangeProposalSettingsView);
    });

    it('tells the admin when the values are fixed by environment variables', async () => {
      fixSettingsByEnvVars();
      asUser(admin);

      const res = await get();

      expect(res.status).toBe(200);
      expect(res.body.settings.useOnlyEnvVars).toBe(true);
    });

    it('refuses a guest with 403', async () => {
      const res = await get();

      expect(res.status).toBe(403);
    });

    // adminRequired redirects a non-admin, as on every other admin route.
    it('redirects a user who is not an admin without the settings', async () => {
      asUser(users.other);

      const res = await get();

      expect(res.status).toBe(302);
      expect(res.body.settings).toBeUndefined();
    });
  });

  describe('PUT /', () => {
    it('stores a partial update, leaves the other values alone and returns the new settings', async () => {
      asUser(admin);

      const res = await put({
        enabledOperationTypes: ['edit'],
        autoApplyPolicy: 'all',
        maxOperationsPerProposal: 10,
        maxProposalsPerUserPerDay: 3,
        perPageNotificationsEnabled: true,
      });

      expect(res.status).toBe(200);
      const expected: ChangeProposalSettingsView = {
        isEnabled: true,
        enabledOperationTypes: ['edit'],
        autoApplyPolicy: 'all',
        maxOperationsPerProposal: 10,
        maxProposalsPerUserPerDay: 3,
        perPageNotificationsEnabled: true,
        useOnlyEnvVars: false,
      };
      expect(res.body.settings).toEqual(expected);
      expect((await get()).body.settings).toEqual(expected);
      expect(readChangeProposalSettings()).toMatchObject({
        enabledOperationTypes: new Set(['edit']),
        autoApplyPolicy: 'all',
        maxOperationsPerProposal: 10,
        maxProposalsPerUserPerDay: 3,
        perPageNotificationsEnabled: true,
      });
    });

    it('accepts an empty list of operation types (every type off)', async () => {
      asUser(admin);

      const res = await put({ enabledOperationTypes: [] });

      expect(res.status).toBe(200);
      expect(res.body.settings.enabledOperationTypes).toEqual([]);
      expect(readChangeProposalSettings().enabledOperationTypes.size).toBe(0);
    });

    it('clears both limits when they are sent as null', async () => {
      await configManager.updateConfigs({
        'changeProposal:maxOperationsPerProposal': 20,
        'changeProposal:maxProposalsPerUserPerDay': 5,
      });
      asUser(admin);

      const res = await put({
        maxOperationsPerProposal: null,
        maxProposalsPerUserPerDay: null,
      });

      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({
        maxOperationsPerProposal: null,
        maxProposalsPerUserPerDay: null,
      });
      expect(readChangeProposalSettings()).toMatchObject({
        maxOperationsPerProposal: null,
        maxProposalsPerUserPerDay: null,
      });

      const reread = await get();
      expect(reread.body.settings).toMatchObject({
        maxOperationsPerProposal: null,
        maxProposalsPerUserPerDay: null,
      });
    });

    it('shows the initial operation cap of 50 and no daily cap before any change', async () => {
      asUser(admin);

      const res = await get();

      expect(res.body.settings).toMatchObject({
        maxOperationsPerProposal: 50,
        maxProposalsPerUserPerDay: null,
      });
    });

    it('records exactly one settings update activity with the admin as operator', async () => {
      asUser(admin);

      const res = await put({ autoApplyPolicy: 'own-pages' });

      expect(res.status).toBe(200);
      const rows = await vi.waitFor(
        async () => {
          const found = await activities();
          if (found.length === 0) {
            throw new Error('no activity yet');
          }
          return found;
        },
        { timeout: 5000, interval: 50 },
      );
      await sleep(ABSENCE_WAIT_MS);
      expect(await activities()).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: SupportedAction.ACTION_ADMIN_CHANGE_PROPOSAL_SETTINGS_UPDATE,
        userId: admin._id.toString(),
      });
    });

    it.each([
      ['isEnabled as a string', { isEnabled: 'false' }],
      ['isEnabled as a number', { isEnabled: 0 }],
      ['an unknown operation type', { enabledOperationTypes: ['trash'] }],
      ['operation types as a string', { enabledOperationTypes: 'edit' }],
      [
        'a repeated operation type',
        { enabledOperationTypes: ['edit', 'edit'] },
      ],
      ['an unknown policy', { autoApplyPolicy: 'sometimes' }],
      ['a zero limit', { maxOperationsPerProposal: 0 }],
      ['a negative limit', { maxProposalsPerUserPerDay: -1 }],
      ['a fractional limit', { maxOperationsPerProposal: 1.5 }],
      ['a limit as a string', { maxOperationsPerProposal: '5' }],
      ['an empty-string limit', { maxProposalsPerUserPerDay: '' }],
      ['an object limit', { maxOperationsPerProposal: { $gt: 0 } }],
      ['the switch as a string', { perPageNotificationsEnabled: 'yes' }],
      ['the read-only env flag', { useOnlyEnvVars: true }],
      ['an unknown key', { pendingExpirationSeconds: 60 }],
    ])('refuses %s with 400 and changes nothing', async (_label, body) => {
      asUser(admin);
      const before = (await get()).body.settings;

      const res = await put({ autoApplyPolicy: 'all', ...body });

      expect(res.status).toBe(400);
      expect((await get()).body.settings).toEqual(before);
    });

    it('records only an unsettled attempt for an invalid update', async () => {
      asUser(admin);

      const res = await put({ maxOperationsPerProposal: 0 });

      expect(res.status).toBe(400);
      await expectOnlyAnUnsettledAttempt();
    });

    it('refuses every change while the values are fixed by environment variables', async () => {
      fixSettingsByEnvVars();
      asUser(admin);

      const res = await put({ autoApplyPolicy: 'all' });

      expect(res.status).toBe(400);
      expect(readChangeProposalSettings().autoApplyPolicy).toBe('none');
      await expectOnlyAnUnsettledAttempt();
    });

    it('refuses a guest with 403 and changes nothing', async () => {
      const res = await put({ autoApplyPolicy: 'all' });

      expect(res.status).toBe(403);
      expect(readChangeProposalSettings().autoApplyPolicy).toBe('none');
    });

    it('does not let a user who is not an admin change the settings, and records nothing', async () => {
      asUser(users.other);

      const res = await put({ isEnabled: false, autoApplyPolicy: 'all' });

      expect(res.status).toBe(302);
      expect(readChangeProposalSettings()).toMatchObject({
        isEnabled: true,
        autoApplyPolicy: 'none',
      });
      await sleep(ABSENCE_WAIT_MS);
      expect(await activities()).toEqual([]);
    });

    it('withdraws the pending proposals before responding when the feature is turned off', async () => {
      const page = await kit.createPage('withdrawn');
      const proposal = await kit.storeProposal([kit.editInput(page)], {
        approve: false,
      });
      asUser(admin);

      const res = await put({ isEnabled: false });

      expect(res.status).toBe(200);
      expect(res.body.settings.isEnabled).toBe(false);
      const reloaded = await kit.reload(proposal._id);
      expect(reloaded.lifecycle).toBe('withdrawn');
      expect(reloaded.operations.map((op) => op.status)).toEqual(['skipped']);
    });

    it('still saves the settings and answers 200 when withdrawing the pending proposals fails', async () => {
      vi.spyOn(service, 'withdrawAllPending').mockRejectedValue(
        new Error('withdraw failed'),
      );
      asUser(admin);

      const res = await put({ isEnabled: false });

      expect(res.status).toBe(200);
      expect(res.body.settings.isEnabled).toBe(false);
      expect(readChangeProposalSettings().isEnabled).toBe(false);
    });

    it('leaves the pending proposals open when the feature stays on', async () => {
      const page = await kit.createPage('kept');
      const proposal = await kit.storeProposal([kit.editInput(page)], {
        approve: false,
      });
      asUser(admin);

      const res = await put({ isEnabled: true, autoApplyPolicy: 'none' });

      expect(res.status).toBe(200);
      const reloaded = await kit.reload(proposal._id);
      expect(reloaded.lifecycle).toBe('open');
      expect(reloaded.operations.map((op) => op.status)).toEqual(['pending']);
    });
  });
});
