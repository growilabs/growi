import type { IUserHasId } from '@growi/core';
import { getIdStringForRef, SubscriptionStatusType } from '@growi/core';
import { YDocStatus } from '@growi/core/dist/consts';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalNotificationSnapshot,
  OperationRecord,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import type { EditingPresenceSource } from './editing-presence';
import {
  createOperationHandlers,
  type OperationHandler,
  type OperationHandlerTable,
} from './operation-handlers';
import {
  createProposalApplier,
  type ProposalApplier,
  type ProposalApplierDeps,
} from './proposal-applier';

// Shared fixtures for the ProposalApplier integration tests. Kept free of vitest
// and the test setup so it type-checks wherever the server program includes it.

type UserRole = 'requester' | 'subscriber' | 'other';

export type HandlerOverrides = Partial<{
  [K in keyof OperationHandlerTable]: Partial<OperationHandlerTable[K]>;
}>;

export type StoreProposalOptions = {
  readonly requester?: string;
  readonly approve?: boolean;
  readonly entry?: ChangeProposalDocument['entry'];
  readonly revertOf?: string;
  readonly basedOn?: ChangeProposalDocument['basedOn'];
  readonly perPageNotifications?: boolean;
};

const PAGE_OPERATION_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const createApplierTestKit = (args: {
  // Resolved lazily: the kit is built at collection time, Crowi in beforeAll.
  readonly getCrowi: () => Crowi;
  readonly prefix: string;
  readonly ip: string;
  readonly usernames: { readonly [R in UserRole]: string };
}) => {
  const { getCrowi, prefix, ip, usernames } = args;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');
  const PageOperation = () =>
    mongoose.model<IPageOperation, PageOperationModel>('PageOperation');
  const users = {} as Record<UserRole, HydratedDocument<IUserHasId>>;
  const proposalIds: string[] = [];
  // Pages a test marks as open in an editor; the integration Crowi has no YjsService.
  const editingPageIds = new Set<string>();
  const presenceSource: EditingPresenceSource = {
    getConnectionCount: (pageId) => (editingPageIds.has(pageId) ? 1 : 0),
    getYDocStatus: async () => YDocStatus.SYNCED,
  };
  let seq = 0;

  const nextPath = (label: string): string => {
    seq += 1;
    return `${prefix}/${label}-${seq}`;
  };

  const waitForPageOperationsToFinish = async (): Promise<void> => {
    const deadline = Date.now() + PAGE_OPERATION_WAIT_MS;
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: polling until background page operations end
      const remaining = await PageOperation().countDocuments({
        fromPath: new RegExp(`^${prefix}/`),
      });
      if (remaining === 0) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`${remaining} page operations still running`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  };

  const findPage = async (
    pageId: mongoose.Types.ObjectId | string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page().findById(pageId);
    if (page == null) {
      throw new Error(`page ${pageId} not found`);
    }
    return page;
  };

  const createPage = async (
    label: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await getCrowi().pageService.create(
      nextPath(label),
      'base body',
      users.other,
      {},
    );
    await waitForPageOperationsToFinish();
    return findPage(page._id);
  };

  const subscribe = (page: HydratedDocument<PageDocument>) =>
    Subscription.subscribeByPageId(
      new mongoose.Types.ObjectId(users.subscriber._id),
      page._id,
      SubscriptionStatusType.SUBSCRIBE,
    );

  const editInput = (
    page: HydratedDocument<PageDocument>,
    body = `proposed body for ${page.path}`,
  ): CreateOperationInput => {
    if (page.revision == null) {
      throw new Error(`page ${page.path} has no revision`);
    }
    return {
      type: 'edit',
      pageId: page._id.toString(),
      baseRevisionId: getIdStringForRef(page.revision),
      body,
    };
  };

  const storeProposal = async (
    operations: readonly CreateOperationInput[],
    options: StoreProposalOptions = {},
  ): Promise<ChangeProposalDocument> => {
    const approvedAt = options.approve === false ? undefined : new Date();
    const created = await prisma.changeproposals.createProposal({
      requester: options.requester ?? users.requester._id.toString(),
      entry: options.entry ?? 'ai-chat',
      revertOf: options.revertOf,
      basedOn: options.basedOn,
      perPageNotifications: options.perPageNotifications ?? false,
      operations: operations.map((op) => ({ ...op, approvedAt })),
    });
    proposalIds.push(created._id);
    return created;
  };

  const reload = async (id: string): Promise<ChangeProposalDocument> => {
    const proposal = await prisma.changeproposals.findProposal(id);
    if (proposal == null) {
      throw new Error(`proposal ${id} not found`);
    }
    return proposal;
  };

  const operationOf = (
    proposal: ChangeProposalDocument,
    key: string,
  ): OperationRecord => {
    const op = proposal.operations.find((o) => o.key === key);
    if (op == null) {
      throw new Error(`operation ${key} not found`);
    }
    return op;
  };

  const markedRevisions = (proposalId: string, key: string) =>
    prisma.revisions.findMany({
      where: { proposalId, proposalOperationKey: key },
    });

  const aggregatedNotifications = (proposalId: string) =>
    InAppNotification.find({
      target: proposalId,
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
    })
      .sort({ _id: 1 })
      .lean()
      .exec();

  const snapshotPagesOf = (
    notification: Awaited<ReturnType<typeof aggregatedNotifications>>[number],
  ): string[] =>
    (
      JSON.parse(notification.snapshot) as ChangeProposalNotificationSnapshot
    ).pages.map((p) => p.id);

  // Real handlers with sendPerPageNotifications replaced (the integration Crowi has
  // no global notification service) and any member overridable per test.
  const buildHandlers = (
    sendPerPageNotifications: OperationHandler<OperationRecord>['sendPerPageNotifications'],
    overrides: HandlerOverrides = {},
  ): { table: OperationHandlerTable; real: OperationHandlerTable } => {
    const real = createOperationHandlers(getCrowi());
    const table: OperationHandlerTable = {
      edit: { ...real.edit, sendPerPageNotifications, ...overrides.edit },
      create: { ...real.create, sendPerPageNotifications, ...overrides.create },
      move: { ...real.move, sendPerPageNotifications, ...overrides.move },
      trash: { ...real.trash, sendPerPageNotifications, ...overrides.trash },
      restore: {
        ...real.restore,
        sendPerPageNotifications,
        ...overrides.restore,
      },
    };
    return { table, real };
  };

  const newApplier = (deps: ProposalApplierDeps = {}): ProposalApplier =>
    createProposalApplier(getCrowi(), { presenceSource, ...deps });

  const setUp = async (): Promise<void> => {
    await configManager.updateConfigs({
      'app:isV5Compatible': true,
      'app:changeProposalEnabled': true,
    });
    if ((await Page().findOne({ path: '/' })) == null) {
      await Page().create({ path: '/', grant: Page().GRANT_PUBLIC });
    }
    const User = mongoose.model<IUserHasId>('User');
    for (const [role, username] of Object.entries(usernames)) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
      users[role as UserRole] = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status: UserStatus.STATUS_ACTIVE,
      });
    }
  };

  const resetPerPageNotificationsSetting = () =>
    configManager.updateConfigs(
      { 'changeProposal:perPageNotificationsEnabled': undefined },
      { removeIfUndefined: true },
    );

  const tearDown = async (): Promise<void> => {
    const pages = await Page().find({ path: new RegExp(`^${prefix}/`) });
    const pageIds = pages.map((p) => p._id);
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map((id) => id.toString()) } },
    });
    await InAppNotification.deleteMany({
      $or: [{ target: { $in: pageIds } }, { target: { $in: proposalIds } }],
    });
    await Subscription.deleteMany({ target: { $in: pageIds } });
    await prisma.activities.deleteMany({ where: { ip } });
    await prisma.changeproposals.deleteMany({
      where: { id: { in: proposalIds } },
    });
    await Page().deleteMany({ _id: { $in: pageIds } });
    await mongoose.model('User').deleteMany({
      username: { $in: Object.values(usernames) },
    });
    await configManager.updateConfigs(
      {
        'app:isV5Compatible': undefined,
        'app:changeProposalEnabled': undefined,
      },
      { removeIfUndefined: true },
    );
  };

  return {
    users,
    nextPath,
    waitForPageOperationsToFinish,
    findPage,
    createPage,
    subscribe,
    editInput,
    storeProposal,
    reload,
    operationOf,
    markedRevisions,
    aggregatedNotifications,
    snapshotPagesOf,
    buildHandlers,
    editingPageIds,
    newApplier,
    setUp,
    resetPerPageNotificationsSetting,
    tearDown,
  };
};

export type ApplierTestKit = ReturnType<typeof createApplierTestKit>;
