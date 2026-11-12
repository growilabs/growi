import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalDocument,
  type ChangeProposalRevertRequestSnapshot,
  REVERT_REQUEST_COOLDOWN_MS,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';
import {
  createRevertRequestService,
  type RevertRequestService,
  type SendRevertRequestArgs,
} from './revert-request-service';

const TEST_IP = '10.0.0.241';
const PREFIX = '/cp-revert-request-service-integ';
const BACKGROUND = { kind: 'background' } as const;
const NOT_FOUND = { ok: false, error: { code: 'not-found' } } as const;
const NOW = new Date('2026-11-12T00:00:00.000Z');

describe('RevertRequestService.sendRevertRequest', () => {
  let crowi: Crowi;
  let coreService: ChangeProposalService;
  let service: RevertRequestService;
  const emitNotificationUpdated =
    vi.fn<(userIds: readonly string[]) => Promise<void>>();
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpRevertRequestRequester',
      subscriber: 'cpRevertRequestSender',
      other: 'cpRevertRequestOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');
  const User = () => mongoose.model<IUserHasId>('User');
  const extraUsernames: string[] = [];

  const send = (
    overrides: Partial<SendRevertRequestArgs> &
      Pick<SendRevertRequestArgs, 'proposalId'>,
  ) =>
    service.sendRevertRequest({
      getService: () => coreService,
      sender: users.subscriber,
      message: 'please revert the rest',
      activityId: new mongoose.Types.ObjectId().toString(),
      now: NOW,
      ...overrides,
    });

  const revertRequestsTo = (proposalId: string) =>
    InAppNotification.find({
      target: proposalId,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
    })
      .lean()
      .exec();

  const snapshotOf = (
    notification: Awaited<ReturnType<typeof revertRequestsTo>>[number],
  ): ChangeProposalRevertRequestSnapshot => JSON.parse(notification.snapshot);

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

  const applyAll = async (
    operations: readonly CreateOperationInput[],
    requester?: string,
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations, { requester });
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const createHiddenPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const createUser = (
    username: string,
  ): Promise<HydratedDocument<IUserHasId>> => {
    extraUsernames.push(username);
    return User().create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
  };

  const seedActivity = (args: {
    readonly sender: IUserHasId;
    readonly proposalId: string;
    readonly action: string;
    readonly createdAt: Date;
  }) =>
    prisma.activities.createByParameters({
      user: args.sender._id.toString(),
      target: args.proposalId,
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      action: args.action,
      ip: TEST_IP,
      createdAt: args.createdAt,
      snapshot: { username: args.sender.username },
    });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    coreService = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    service = createRevertRequestService({ emitNotificationUpdated });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    emitNotificationUpdated.mockReset();
    emitNotificationUpdated.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const trashed = await Page().find({
      path: new RegExp(`^/trash${PREFIX}/`),
    });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: trashed.map((p) => p._id.toString()) } },
    });
    await Page().deleteMany({ _id: { $in: trashed.map((p) => p._id) } });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
    // Revert proposals made through the core service are not tracked by the kit.
    const revertProposals = await prisma.changeproposals.findMany({
      where: { requester: users.requester._id.toString() },
      select: { id: true },
    });
    await InAppNotification.deleteMany({
      target: { $in: revertProposals.map((p) => p.id) },
    });
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await User().deleteMany({ username: { $in: extraUsernames } });
    await kit.tearDown();
  });

  describe('when the request can be sent', () => {
    it('adds exactly one unread notification for the requester carrying only the sender, the message and the proposal', async () => {
      const page = await kit.createPage('send-ok');
      const proposal = await applyAll([kit.editInput(page)]);
      const activityId = new mongoose.Types.ObjectId().toString();

      const result = await send({
        proposalId: proposal._id,
        message: '残りも戻してください <b>please</b>',
        activityId,
      });

      expect(result).toEqual({ ok: true });
      const notifications = await revertRequestsTo(proposal._id);
      expect(notifications).toHaveLength(1);
      const [notification] = notifications;
      expect(notification).toMatchObject({
        targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
        status: InAppNotificationStatuses.STATUS_UNOPENED,
        snapshot: expect.any(String),
      });
      expect(notification.user.toString()).toBe(users.requester._id.toString());
      expect(notification.target.toString()).toBe(proposal._id);
      expect(notification.activities.map(String)).toEqual([activityId]);
      expect(snapshotOf(notification)).toEqual({
        proposalId: proposal._id,
        kind: 'revert-request',
        sender: {
          id: users.subscriber._id.toString(),
          username: users.subscriber.username,
        },
        message: '残りも戻してください <b>please</b>',
      });
      expect(emitNotificationUpdated).toHaveBeenCalledTimes(1);
      expect(emitNotificationUpdated).toHaveBeenCalledWith([
        users.requester._id.toString(),
      ]);
    });

    it('stores an omitted message as an empty string', async () => {
      const page = await kit.createPage('send-empty');
      const proposal = await applyAll([kit.editInput(page)]);

      const result = await send({ proposalId: proposal._id, message: '' });

      expect(result).toEqual({ ok: true });
      const [notification] = await revertRequestsTo(proposal._id);
      expect(snapshotOf(notification).message).toBe('');
    });
  });

  describe('when the sender cannot open the proposal', () => {
    it('answers a missing id, a malformed id, a hidden proposal and one whose visible operations are all pending identically, and notifies nobody', async () => {
      const hidden = await createHiddenPage('hidden-applied');
      const hiddenProposal = await applyAll([kit.editInput(hidden)]);
      const waiting = await kit.createPage('visible-pending');
      const pendingProposal = await kit.storeProposal(
        [kit.editInput(waiting)],
        { approve: false },
      );

      const results = await Promise.all([
        send({ proposalId: new mongoose.Types.ObjectId().toString() }),
        send({ proposalId: 'not-an-id' }),
        send({ proposalId: hiddenProposal._id }),
        send({ proposalId: pendingProposal._id }),
      ]);

      for (const result of results) {
        expect(result).toEqual(NOT_FOUND);
      }
      expect(await revertRequestsTo(hiddenProposal._id)).toHaveLength(0);
      expect(await revertRequestsTo(pendingProposal._id)).toHaveLength(0);
      expect(emitNotificationUpdated).not.toHaveBeenCalled();
    });
  });

  describe('operations the sender cannot see', () => {
    it('gives the same result and notification content whether a hidden operation is applied or reverted', async () => {
      const buildProposal = async (label: string) => {
        const visible = await kit.createPage(`${label}-visible`);
        const hidden = await createHiddenPage(`${label}-hidden`);
        return applyAll([kit.editInput(visible), kit.editInput(hidden)]);
      };
      const applied = await buildProposal('hidden-state-applied');
      const reverted = await buildProposal('hidden-state-reverted');
      const hiddenKey = keyOf(reverted, 1);
      const revert = await coreService.revert(
        reverted._id,
        users.requester,
        [hiddenKey],
        BACKGROUND,
      );
      await kit.waitForPageOperationsToFinish();
      expect(revert.ok).toBe(true);
      expect(
        kit.operationOf(await kit.reload(reverted._id), hiddenKey).status,
      ).toBe('reverted');
      expect(kit.operationOf(applied, keyOf(applied, 1)).status).toBe(
        'applied',
      );

      const resultForApplied = await send({ proposalId: applied._id });
      const resultForReverted = await send({ proposalId: reverted._id });

      expect(resultForApplied).toEqual({ ok: true });
      expect(resultForReverted).toEqual(resultForApplied);
      const [forApplied] = await revertRequestsTo(applied._id);
      const [forReverted] = await revertRequestsTo(reverted._id);
      expect({ ...snapshotOf(forReverted), proposalId: '' }).toEqual({
        ...snapshotOf(forApplied),
        proposalId: '',
      });
    });
  });

  describe('refusals', () => {
    it('refuses the requester asking themselves', async () => {
      const page = await kit.createPage('own');
      const proposal = await applyAll([kit.editInput(page)]);

      const result = await send({
        proposalId: proposal._id,
        sender: users.requester,
      });

      expect(result).toEqual({ ok: false, error: { code: 'own-proposal' } });
      expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
      expect(emitNotificationUpdated).not.toHaveBeenCalled();
    });

    it('refuses when the requester is no longer an active user', async () => {
      const requester = await createUser('cpRevertRequestSuspended');
      const page = await kit.createPage('inactive');
      const proposal = await applyAll(
        [kit.editInput(page)],
        requester._id.toString(),
      );
      await User().updateOne(
        { _id: requester._id },
        { status: UserStatus.STATUS_SUSPENDED },
      );

      const result = await send({ proposalId: proposal._id });

      expect(result).toEqual({
        ok: false,
        error: { code: 'requester-unavailable' },
      });
      expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
      expect(emitNotificationUpdated).not.toHaveBeenCalled();
    });
  });

  describe('cooldown', () => {
    let proposal: ChangeProposalDocument;
    let otherProposal: ChangeProposalDocument;

    beforeAll(async () => {
      const page = await kit.createPage('cooldown');
      proposal = await applyAll([kit.editInput(page)]);
      const otherPage = await kit.createPage('cooldown-other');
      otherProposal = await applyAll([kit.editInput(otherPage)]);
    });

    afterEach(async () => {
      await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
      await InAppNotification.deleteMany({
        target: { $in: [proposal._id, otherProposal._id] },
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
      });
    });

    it('refuses a second request by the same sender for the same proposal within the cooldown', async () => {
      await seedActivity({
        sender: users.subscriber,
        proposalId: proposal._id,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        createdAt: new Date(NOW.getTime() - REVERT_REQUEST_COOLDOWN_MS + 1000),
      });

      const result = await send({ proposalId: proposal._id });

      expect(result).toEqual({
        ok: false,
        error: { code: 'recently-requested' },
      });
      expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
      expect(emitNotificationUpdated).not.toHaveBeenCalled();
    });

    it('accepts a request once the cooldown has passed', async () => {
      await seedActivity({
        sender: users.subscriber,
        proposalId: proposal._id,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        createdAt: new Date(NOW.getTime() - REVERT_REQUEST_COOLDOWN_MS - 1000),
      });

      const result = await send({ proposalId: proposal._id });

      expect(result).toEqual({ ok: true });
      expect(await revertRequestsTo(proposal._id)).toHaveLength(1);
    });

    it('does not count refused attempts, which leave only unsettled activities', async () => {
      await seedActivity({
        sender: users.subscriber,
        proposalId: proposal._id,
        action: SupportedAction.ACTION_UNSETTLED,
        createdAt: new Date(NOW.getTime() - 1000),
      });

      const result = await send({ proposalId: proposal._id });

      expect(result).toEqual({ ok: true });
    });

    it('lets another sender ask about the same proposal, and the same sender ask about another proposal', async () => {
      await seedActivity({
        sender: users.subscriber,
        proposalId: proposal._id,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        createdAt: new Date(NOW.getTime() - 1000),
      });

      const byOtherSender = await send({
        proposalId: proposal._id,
        sender: users.other,
      });
      const forOtherProposal = await send({ proposalId: otherProposal._id });

      expect(byOtherSender).toEqual({ ok: true });
      expect(forOtherProposal).toEqual({ ok: true });
      const [notification] = await revertRequestsTo(proposal._id);
      expect(snapshotOf(notification).sender.id).toBe(
        users.other._id.toString(),
      );
      expect(await revertRequestsTo(otherProposal._id)).toHaveLength(1);
    });
  });
});
