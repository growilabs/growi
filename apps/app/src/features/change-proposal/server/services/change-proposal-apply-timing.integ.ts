import type { IUserHasId } from '@growi/core';
import { getIdStringForRef, SubscriptionStatusType } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { GlobalNotificationService } from '~/server/service/global-notification';
import type MailService from '~/server/service/mail/mail';
import type { UserNotificationService } from '~/server/service/user-notification';
import { prisma } from '~/utils/prisma';

import type { CreatableOperationInput } from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

// Records how long applying a proposal of the default operation cap takes with
// per-page notifications off and on (task 8.4). It asserts the outcome only, not
// a time limit: the numbers depend on the machine and are written to research.md.
// Opt-in because it is slow: run with CHANGE_PROPOSAL_MEASURE_TIMING=1.

const TEST_IP = '10.0.0.184';
const TEST_ENDPOINT = '/_api/v3/cp-apply-timing-integ';
const PREFIX = '/cp-apply-timing-integ';
const BACKGROUND = { kind: 'background' } as const;
const EDIT_COUNT = 45;
const CREATE_COUNT = 5;
const OPERATION_COUNT = EDIT_COUNT + CREATE_COUNT;
const EXTRA_SUBSCRIBER_COUNT = 4;
const REPETITIONS = 3;
const NOTIFICATION_WAIT_MS = 60_000;
const TEST_TIMEOUT_MS = 600_000;

type Mode = 'off' | 'on';
type Sample = { readonly approveMs: number; readonly settledMs: number };

const summarize = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    min: round(sorted[0]),
    median: round(median),
    max: round(sorted[sorted.length - 1]),
    medianPerOperation: round(median / OPERATION_COUNT),
  };
};

describe.skipIf(!process.env.CHANGE_PROPOSAL_MEASURE_TIMING)(
  'change proposal apply timing with the default operation cap',
  () => {
    let crowi: Crowi;
    let service: ChangeProposalService;
    let mailSend: ReturnType<typeof vi.fn>;
    let restoreServices: () => void = () => {};
    const extraSubscribers: HydratedDocument<IUserHasId>[] = [];
    const kit = createApplierTestKit({
      getCrowi: () => crowi,
      prefix: PREFIX,
      ip: TEST_IP,
      usernames: {
        requester: 'cpApplyTimingRequester',
        subscriber: 'cpApplyTimingSubscriber',
        other: 'cpApplyTimingOther',
      },
    });
    const { users } = kit;
    const extraUsernames = Array.from(
      { length: EXTRA_SUBSCRIBER_COUNT },
      (_, i) => `cpApplyTimingSubscriber${i + 2}`,
    );
    const subscriberIds = () =>
      [users.subscriber, ...extraSubscribers].map((u) => u._id);

    // A real global notification service: the setting lookup and the mail option
    // generation run, only the final mail transport is stubbed.
    const installNotificationServices = () => {
      const originals = {
        global: crowi.globalNotificationService,
        user: crowi.userNotificationService,
        mail: crowi.mailService,
      };
      restoreServices = () => {
        crowi.globalNotificationService = originals.global;
        crowi.userNotificationService = originals.user;
        crowi.mailService = originals.mail;
      };
      crowi.globalNotificationService = new GlobalNotificationService(crowi);
      crowi.userNotificationService = mock<UserNotificationService>();
      mailSend = vi.fn().mockResolvedValue(undefined);
      crowi.mailService = mock<MailService>({ send: mailSend });
    };

    const prepareOperations = async (
      label: string,
    ): Promise<{
      operations: CreatableOperationInput[];
      pageIds: string[];
    }> => {
      const pages: HydratedDocument<PageDocument>[] = [];
      for (let i = 0; i < EDIT_COUNT; i++) {
        // biome-ignore lint/performance/noAwaitInLoops: fixture pages are created outside the timed window
        const page = await kit.createPage(`${label}/edit-${i}`);
        await Promise.all(
          subscriberIds().map((userId) =>
            Subscription.subscribeByPageId(
              new mongoose.Types.ObjectId(userId),
              page._id,
              SubscriptionStatusType.SUBSCRIBE,
            ),
          ),
        );
        pages.push(page);
      }
      const operations: CreatableOperationInput[] = [
        ...pages.map(
          (page): CreatableOperationInput => ({
            type: 'edit',
            pageId: page._id.toString(),
            baseRevisionId: getIdStringForRef(page.revision ?? ''),
            body: `# 提案した本文 ${page.path}`,
          }),
        ),
        ...Array.from({ length: CREATE_COUNT }, (_, i) => ({
          type: 'create' as const,
          path: kit.nextPath(`${label}/create-${i}`),
          body: '作った本文',
        })),
      ];
      return { operations, pageIds: pages.map((p) => p._id.toString()) };
    };

    const countPerPageNotifications = (pageIds: readonly string[]) =>
      InAppNotification.countDocuments({
        user: { $in: subscriberIds() },
        target: { $in: pageIds },
        action: SupportedAction.ACTION_PAGE_UPDATE,
      }).exec();

    const runOnce = async (mode: Mode, label: string): Promise<Sample> => {
      await configManager.updateConfigs({
        'changeProposal:perPageNotificationsEnabled': mode === 'on',
      });
      const { operations, pageIds } = await prepareOperations(label);
      const created = await service.createProposal({
        requester: users.requester,
        entry: 'ai-chat',
        operations,
        perPageNotifications: true,
        request: { ip: TEST_IP, endpoint: TEST_ENDPOINT },
      });
      if (!created.ok) throw new Error(JSON.stringify(created.error));
      expect(created.value.apply).toBeNull();
      const { proposalId } = created.value;
      mailSend.mockClear();

      const start = performance.now();
      const result = await service.approve(
        proposalId,
        users.requester,
        'all',
        BACKGROUND,
      );
      const approveMs = performance.now() - start;
      const expectedPerPage =
        mode === 'on' ? EDIT_COUNT * subscriberIds().length : 0;
      await vi.waitFor(
        async () => {
          expect(await countPerPageNotifications(pageIds)).toBe(
            expectedPerPage,
          );
        },
        { timeout: NOTIFICATION_WAIT_MS, interval: 20 },
      );
      const settledMs = performance.now() - start;

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value.type).toBe('done');
      const stored = await kit.reload(proposalId);
      expect(stored.lifecycle).toBe('settled');
      expect(stored.operations.map((op) => op.status)).toEqual(
        Array(OPERATION_COUNT).fill('applied'),
      );
      expect(mailSend).toHaveBeenCalledTimes(
        mode === 'on' ? OPERATION_COUNT : 0,
      );
      expect(await kit.aggregatedNotifications(proposalId)).toHaveLength(
        subscriberIds().length,
      );
      return { approveMs, settledMs };
    };

    beforeAll(async () => {
      crowi = await getInstance();
      await kit.setUp();
      const User = mongoose.model<IUserHasId>('User');
      for (const username of extraUsernames) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
        const user = await User.create({
          name: username,
          username,
          email: `${username}@example.com`,
          status: UserStatus.STATUS_ACTIVE,
        });
        extraSubscribers.push(user);
      }
      await crowi.models.GlobalNotificationMailSetting.create({
        triggerPath: `${PREFIX}/*`,
        triggerEvents: [
          GlobalNotificationSettingEvent.PAGE_EDIT,
          GlobalNotificationSettingEvent.PAGE_CREATE,
        ],
        toEmail: 'cp-apply-timing@example.com',
      });
      await configManager.updateConfigs({
        'changeProposal:autoApplyPolicy': 'none',
        // The mail option builds page URLs from it.
        'app:siteUrl': 'http://localhost:3000',
      });
      service = createChangeProposalService(crowi, {
        applier: kit.newApplier(),
      });
    });

    afterAll(async () => {
      restoreServices();
      vi.restoreAllMocks();
      const proposals = await prisma.changeproposals.findMany({
        where: { requester: users.requester._id.toString() },
        select: { id: true },
      });
      const ids = proposals.map((p) => p.id);
      await InAppNotification.deleteMany({ target: { $in: ids } });
      await prisma.activities.deleteMany({ where: { target: { in: ids } } });
      await prisma.changeproposals.deleteMany({ where: { id: { in: ids } } });
      await crowi.models.GlobalNotificationSetting.deleteMany({
        triggerPath: `${PREFIX}/*`,
      });
      await mongoose
        .model('User')
        .deleteMany({ username: { $in: extraUsernames } });
      await kit.resetPerPageNotificationsSetting();
      await configManager.updateConfigs(
        {
          'changeProposal:autoApplyPolicy': undefined,
          'app:siteUrl': undefined,
        },
        { removeIfUndefined: true },
      );
      await kit.tearDown();
    });

    it(
      'applies all 50 operations in both modes and records the durations',
      async () => {
        // Page events have async listeners (search, vault) unrelated to the apply path.
        vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
        installNotificationServices();

        // Warm-up, discarded; then the modes are interleaved so drift hits both alike.
        await runOnce('off', 'warmup');
        const samples: Record<Mode, Sample[]> = { off: [], on: [] };
        for (let rep = 0; rep < REPETITIONS; rep++) {
          for (const mode of ['off', 'on'] as const) {
            // biome-ignore lint/performance/noAwaitInLoops: runs must not overlap or the timings interfere
            samples[mode].push(await runOnce(mode, `${mode}-${rep}`));
          }
        }

        const report = Object.fromEntries(
          (['off', 'on'] as const).map((mode) => [
            mode,
            {
              approve: summarize(samples[mode].map((s) => s.approveMs)),
              untilPerPageNotifications: summarize(
                samples[mode].map((s) => s.settledMs),
              ),
              rawMs: samples[mode].map((s) => [
                Math.round(s.approveMs),
                Math.round(s.settledMs),
              ]),
            },
          ]),
        );
        // biome-ignore lint/suspicious/noConsole: printing the measurement is the purpose of this test
        console.info(
          `change-proposal apply timing (${OPERATION_COUNT} operations, ${subscriberIds().length} subscribers): ${JSON.stringify(report)}`,
        );
        expect(samples.off).toHaveLength(REPETITIONS);
        expect(samples.on).toHaveLength(REPETITIONS);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
