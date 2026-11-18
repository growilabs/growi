import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { MaintenanceActions } from './maintenance-actions';
import {
  type ChangeProposalMaintenanceCronDeps,
  ChangeProposalMaintenanceCronService,
  startChangeProposalMaintenanceCronIfEnabled,
} from './maintenance-cron';
import {
  createApplierTestKit,
  type StoreProposalOptions,
} from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.159';
const PREFIX = '/cp-maintenance-cron-integ';
const AN_HOUR_MS = 60 * 60 * 1000;
const SCHEDULE_KEY = 'changeProposal:maintenanceCronSchedule';

describe('Change proposal maintenance cron', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpMaintenanceCronRequester',
      subscriber: 'cpMaintenanceCronSubscriber',
      other: 'cpMaintenanceCronOther',
    },
  });
  const now = new Date();

  const storeEdit = async (
    label: string,
    options: StoreProposalOptions = {},
  ): Promise<ChangeProposalDocument> =>
    kit.storeProposal([kit.editInput(await kit.createPage(label))], {
      approve: false,
      ...options,
    });

  const storeStalled = async (label: string) => {
    const proposal = await storeEdit(label);
    const token = `stalled-${proposal._id}`;
    await prisma.changeproposals.claimApplyLease(proposal._id, token, now);
    await prisma.changeproposals.recordOperationOutcome(
      proposal._id,
      token,
      proposal.operations[0].key,
      { status: 'failed', reason: 'write-error' },
      now,
    );
    await prisma.changeproposals.releaseApplyLease(proposal._id, token);
    return proposal;
  };

  // One proposal for each kind of work a run does.
  const storeOneOfEach = async () => ({
    waiting: await storeEdit('waiting'),
    overdue: await storeEdit('overdue', {
      expiresAt: new Date(now.getTime() - AN_HOUR_MS),
    }),
    interrupted: await kit.storeProposal(
      [kit.editInput(await kit.createPage('割り込み（再開）'))],
      { approve: true },
    ),
    stalled: await storeStalled('stalled'),
  });

  const lifecycleOf = async (proposal: ChangeProposalDocument) =>
    (await kit.reload(proposal._id)).lifecycle;

  const newCron = (
    overrides: Partial<ChangeProposalMaintenanceCronDeps> = {},
  ) =>
    new ChangeProposalMaintenanceCronService({
      actions: service,
      isMaintenanceMode: () => false,
      isYjsReady: () => true,
      sleep: async () => {},
      now: () => now,
      ...overrides,
    });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier({
        handlers: kit.buildHandlers(async () => {}).table,
      }),
    });
  });

  beforeEach(async () => {
    await prisma.changeproposals.deleteMany({});
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      { 'app:changeProposalEnabled': true, [SCHEDULE_KEY]: undefined },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await kit.tearDown();
  });

  describe('one run', () => {
    it('expires, resumes and settles while the feature is enabled, withdrawing nothing', async () => {
      const { waiting, overdue, interrupted, stalled } = await storeOneOfEach();

      await newCron().executeJob();

      expect(await lifecycleOf(waiting)).toBe('open');
      expect(await lifecycleOf(overdue)).toBe('expired');
      expect(await lifecycleOf(interrupted)).toBe('settled');
      expect((await kit.reload(interrupted._id)).operations[0].status).toBe(
        'applied',
      );
      expect(await lifecycleOf(stalled)).toBe('settled');
    });

    it('withdraws the pending proposals while the feature is disabled', async () => {
      const { waiting, stalled } = await storeOneOfEach();
      await configManager.updateConfigs({ 'app:changeProposalEnabled': false });

      await newCron().executeJob();

      expect(await lifecycleOf(waiting)).toBe('withdrawn');
      expect(await lifecycleOf(stalled)).toBe('settled');
    });

    it('does nothing in maintenance mode', async () => {
      const { waiting, overdue, interrupted, stalled } = await storeOneOfEach();
      await configManager.updateConfigs({ 'app:changeProposalEnabled': false });

      await newCron({ isMaintenanceMode: () => true }).executeJob();

      for (const proposal of [waiting, overdue, interrupted, stalled]) {
        // biome-ignore lint/performance/noAwaitInLoops: four reads
        expect(await lifecycleOf(proposal)).toBe('open');
      }
    });

    it('leaves approved operations waiting until the YjsService is up, but still does the rest', async () => {
      const { overdue, interrupted, stalled } = await storeOneOfEach();

      await newCron({ isYjsReady: () => false }).executeJob();

      const waiting = await kit.reload(interrupted._id);
      expect(waiting.lifecycle).toBe('open');
      expect(waiting.operations[0].status).toBe('pending');
      expect(waiting.operations[0].approvedAt).toBeInstanceOf(Date);
      expect(await lifecycleOf(overdue)).toBe('expired');
      expect(await lifecycleOf(stalled)).toBe('settled');
    });

    it('goes on to the next step when one step fails', async () => {
      const { interrupted, stalled } = await storeOneOfEach();
      const failingExpiry: MaintenanceActions = {
        ...service,
        expireDueProposals: () =>
          Promise.reject(new Error('database went away')),
      };

      await newCron({ actions: failingExpiry }).executeJob();

      expect(await lifecycleOf(interrupted)).toBe('settled');
      expect(await lifecycleOf(stalled)).toBe('settled');
    });

    it('skips a tick that arrives while the previous run on this server is still going', async () => {
      const { overdue } = await storeOneOfEach();
      let releaseFirst: () => void = () => {};
      const firstSleep = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let runs = 0;
      const cron = newCron({
        sleep: () => {
          runs += 1;
          return runs === 1 ? firstSleep : Promise.resolve();
        },
      });

      const first = cron.executeJob();
      await cron.executeJob();
      expect(runs).toBe(1);
      expect(await lifecycleOf(overdue)).toBe('open');

      releaseFirst();
      await first;
      expect(await lifecycleOf(overdue)).toBe('expired');

      await cron.executeJob();
      expect(runs).toBe(2);
    });
  });

  describe('startChangeProposalMaintenanceCronIfEnabled', () => {
    const startCron = () => {
      const started = vi
        .spyOn(CronService.prototype, 'startCron')
        .mockImplementation(() => {});
      startChangeProposalMaintenanceCronIfEnabled(crowi);
      return started;
    };

    it('starts the cron even while the feature is disabled', async () => {
      await configManager.updateConfigs({ 'app:changeProposalEnabled': false });

      expect(startCron()).toHaveBeenCalledTimes(1);
    });

    it('does not start the cron when the schedule is empty', async () => {
      await configManager.updateConfigs({ [SCHEDULE_KEY]: '  ' });

      expect(startCron()).not.toHaveBeenCalled();
    });

    it('logs and carries on when the schedule is not a valid cron expression', async () => {
      await configManager.updateConfigs({ [SCHEDULE_KEY]: 'not a cron' });

      expect(() =>
        startChangeProposalMaintenanceCronIfEnabled(crowi),
      ).not.toThrow();
    });
  });
});
