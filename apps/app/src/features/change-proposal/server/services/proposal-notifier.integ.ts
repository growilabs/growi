import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant, SubscriptionStatusType } from '@growi/core';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import { setup as setupInAppNotificationRouter } from '~/server/routes/apiv3/in-app-notification';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalNotificationSnapshot,
  OperationRecord,
  OperationStatus,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import { createProposalNotifier } from './proposal-notifier';

const TEST_USER_HEADER = 'x-cp-notifier-test-user';

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () =>
    (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
}));

vi.mock('~/server/middlewares/login-required', async () => {
  const { default: mongooseForMock } = await import('mongoose');
  return {
    default: () => async (req: Request, _res: Response, next: NextFunction) => {
      const user = await mongooseForMock
        .model('User')
        .findById(req.header('x-cp-notifier-test-user'));
      Object.assign(req, { user });
      next();
    },
  };
});

const PREFIX = '/cp-proposal-notifier-integ';
const SECRET_BODY = 'CP-NOTIFIER-SECRET-BODY';
const USERNAMES = {
  requester: 'cpNotifierRequester',
  subscriber: 'cpNotifierSubscriber',
  outsider: 'cpNotifierOutsider',
  suspended: 'cpNotifierSuspended',
  original: 'cpNotifierOriginalRequester',
} as const;
const GROUP_NAME = 'cpNotifierGroup';

type Snapshot = ChangeProposalNotificationSnapshot;

describe('ProposalNotifier.notifyApplied', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let app: express.Express;
  let groupId: mongoose.Types.ObjectId;
  const users = {} as Record<
    keyof typeof USERNAMES,
    HydratedDocument<IUserHasId>
  >;
  let seq = 0;

  const nextPath = (label: string): string => {
    seq += 1;
    return `${PREFIX}/${label}-${seq}`;
  };

  const createPage = (
    label: string,
    grant: PageGrant = PageGrant.GRANT_PUBLIC,
    extra: Partial<PageDocument> = {},
  ): Promise<HydratedDocument<PageDocument>> =>
    Page.create({
      path: nextPath(label),
      grant,
      grantedGroups:
        grant === PageGrant.GRANT_USER_GROUP
          ? [{ item: groupId, type: GroupType.userGroup }]
          : [],
      isEmpty: false,
      ...extra,
    });

  const subscribe = (
    user: HydratedDocument<IUserHasId>,
    ...pages: HydratedDocument<PageDocument>[]
  ) =>
    Promise.all(
      pages.map((page) =>
        Subscription.subscribeByPageId(
          new mongoose.Types.ObjectId(user._id),
          page._id,
          SubscriptionStatusType.SUBSCRIBE,
        ),
      ),
    );

  const editInput = (page: HydratedDocument<PageDocument>) =>
    ({
      type: 'edit',
      pageId: page._id.toString(),
      baseRevisionId: new mongoose.Types.ObjectId().toString(),
      body: `${SECRET_BODY} for ${page.path}`,
    }) as const;

  // Stores the proposal, then returns it as ProposalApplier would read it after
  // a run: each operation carries the given status (and a result page for creates).
  const storeProposal = async (
    args: {
      requester: HydratedDocument<IUserHasId>;
      entry?: ChangeProposalDocument['entry'];
      revertOf?: string;
      perPageNotifications?: boolean;
    },
    operations: readonly {
      input: CreateOperationInput;
      status: OperationStatus;
      resultPageId?: string;
    }[],
  ): Promise<ChangeProposalDocument> => {
    const created = await prisma.changeproposals.createProposal({
      requester: args.requester._id.toString(),
      entry: args.entry ?? 'ai-chat',
      revertOf: args.revertOf,
      perPageNotifications: args.perPageNotifications ?? false,
      operations: operations.map(({ input }) => input),
    });
    return {
      ...created,
      operations: created.operations.map(
        (op, i): OperationRecord => ({
          ...op,
          status: operations[i].status,
          ...(operations[i].resultPageId == null
            ? {}
            : { resultPageId: operations[i].resultPageId }),
        }),
      ),
    };
  };

  const notificationsFor = (proposalId: string) =>
    InAppNotification.find({ target: proposalId }).lean().exec();

  const snapshotOf = (
    notifications: Awaited<ReturnType<typeof notificationsFor>>,
    user: HydratedDocument<IUserHasId>,
  ): Snapshot | undefined => {
    const found = notifications.find(
      (n) => n.user.toString() === user._id.toString(),
    );
    return found == null ? undefined : JSON.parse(found.snapshot);
  };

  const pageEntry = (page: HydratedDocument<PageDocument>) => ({
    id: page._id.toString(),
    path: page.path,
  });

  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    const User = mongoose.model<IUserHasId>('User');
    for (const [key, username] of Object.entries(USERNAMES)) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
      users[key as keyof typeof USERNAMES] = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status:
          key === 'suspended'
            ? UserStatus.STATUS_SUSPENDED
            : UserStatus.STATUS_ACTIVE,
      });
    }

    const UserGroup = mongoose.model('UserGroup');
    groupId = (await UserGroup.create({ name: GROUP_NAME }))._id;
    await mongoose.model('UserGroupRelation').create(
      [users.requester, users.subscriber, users.suspended].map((u) => ({
        relatedGroup: groupId,
        relatedUser: u._id,
      })),
    );

    addCustomFunctionToResponse(express);
    app = express();
    app.use('/in-app-notification', setupInAppNotificationRouter(crowi));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const pages = await Page.find({
      path: new RegExp(`^(/trash)?${PREFIX}(/|$)`),
    });
    const pageIds = pages.map((p) => p._id);
    const userIds = Object.values(users).map((u) => u._id);
    await InAppNotification.deleteMany({ user: { $in: userIds } });
    await Subscription.deleteMany({ target: { $in: pageIds } });
    await prisma.changeproposals.deleteMany({
      where: { requester: { in: userIds.map((id) => id.toString()) } },
    });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: groupId });
    await mongoose.model('UserGroup').deleteMany({ _id: groupId });
    await mongoose.model('User').deleteMany({ _id: { $in: userIds } });
    await configManager.updateConfigs(
      { 'changeProposal:perPageNotificationsEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  describe('a normal proposal', () => {
    let proposal: ChangeProposalDocument;
    let activityId: string;
    const pages = {} as Record<
      'edited' | 'moved' | 'linkOnly' | 'created' | 'stale',
      HydratedDocument<PageDocument>
    >;

    beforeAll(async () => {
      // Group pages and a link-only page leave the outsider nothing to view.
      pages.edited = await createPage('edited', PageGrant.GRANT_USER_GROUP);
      pages.moved = await createPage('moved', PageGrant.GRANT_USER_GROUP);
      pages.linkOnly = await createPage(
        'link-only',
        PageGrant.GRANT_RESTRICTED,
      );
      pages.created = await createPage('created');
      pages.stale = await createPage('stale');

      await subscribe(users.subscriber, ...Object.values(pages));
      await subscribe(users.outsider, pages.moved, pages.linkOnly);
      await subscribe(users.suspended, pages.edited);
      await subscribe(users.requester, pages.edited);

      proposal = await storeProposal({ requester: users.requester }, [
        { input: editInput(pages.edited), status: 'applied' },
        {
          input: {
            type: 'move',
            pageId: pages.moved._id.toString(),
            fromPath: `${pages.moved.path}-before`,
            toPath: pages.moved.path,
          },
          status: 'applied',
        },
        { input: editInput(pages.linkOnly), status: 'applied' },
        {
          input: {
            type: 'create',
            path: pages.created.path,
            body: SECRET_BODY,
          },
          status: 'applied',
          resultPageId: pages.created._id.toString(),
        },
        { input: editInput(pages.stale), status: 'stale' },
      ]);
      activityId = new mongoose.Types.ObjectId().toString();

      await createProposalNotifier(crowi).notifyApplied({
        proposal,
        activityId,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      });
    });

    it('creates one notification for a subscriber, built only from applied edits and moves the subscriber can view', async () => {
      const notifications = await notificationsFor(proposal._id);
      const forSubscriber = notifications.filter(
        (n) => n.user.toString() === users.subscriber._id.toString(),
      );

      expect(forSubscriber).toHaveLength(1);
      expect(forSubscriber[0]).toMatchObject({
        targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        status: 'UNOPENED',
      });
      expect(forSubscriber[0].target.toString()).toBe(proposal._id);
      expect(forSubscriber[0].activities.map(String)).toEqual([activityId]);

      const snapshot = snapshotOf(notifications, users.subscriber);
      expect(snapshot).toEqual({
        proposalId: proposal._id,
        entry: 'ai-chat',
        kind: 'apply',
        requester: {
          id: users.requester._id.toString(),
          username: USERNAMES.requester,
        },
        pages: expect.any(Array),
      });
      expect([...(snapshot?.pages ?? [])].sort(byId)).toEqual(
        [pageEntry(pages.edited), pageEntry(pages.moved)].sort(byId),
      );
    });

    it('creates nothing for a subscriber who can view none of the pages, a suspended subscriber, or the requester', async () => {
      const notifications = await notificationsFor(proposal._id);

      const nameOf = (id: string) =>
        Object.entries(users).find(([, u]) => u._id.toString() === id)?.[0];
      expect(notifications.map((n) => nameOf(n.user.toString()))).toEqual([
        'subscriber',
      ]);
    });

    it('lets the notification list API return only the recipient snapshot, with the proposal as a bare id', async () => {
      const res = await request(app)
        .get('/in-app-notification/list')
        .set(TEST_USER_HEADER, users.subscriber._id.toString());

      expect(res.status).toBe(200);
      const listed = res.body.docs.find(
        (doc: { targetModel: string }) =>
          doc.targetModel === SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      );
      expect(listed.target).toEqual({ _id: proposal._id });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(SECRET_BODY);
      for (const hidden of [pages.linkOnly, pages.created, pages.stale]) {
        expect(raw).not.toContain(hidden.path);
        expect(raw).not.toContain(hidden._id.toString());
      }
      expect(raw).not.toContain(`${pages.moved.path}-before`);
      expect(JSON.parse(listed.snapshot).pages).toHaveLength(2);
    });

    it('never lets the notification list API load the proposal behind a ChangeProposal notification', async () => {
      // Inserted directly so the list behavior is checked apart from the notifier.
      await InAppNotification.create({
        user: users.outsider._id,
        targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
        target: proposal._id,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        activities: [],
        snapshot: '{}',
      });
      // A page notification in the same list must still carry its loaded page.
      await InAppNotification.create({
        user: users.outsider._id,
        targetModel: SupportedTargetModel.MODEL_PAGE,
        target: pages.stale._id,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        activities: [],
        snapshot: '{}',
      });

      const res = await request(app)
        .get('/in-app-notification/list')
        .set(TEST_USER_HEADER, users.outsider._id.toString());

      expect(res.status).toBe(200);
      type ListedDoc = { targetModel: string; target: Record<string, unknown> };
      const docs: ListedDoc[] = res.body.docs;
      expect(docs).toHaveLength(2);
      const listedProposal = docs.find(
        (doc) => doc.targetModel === SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      );
      const listedPage = docs.find(
        (doc) => doc.targetModel === SupportedTargetModel.MODEL_PAGE,
      );
      expect(listedProposal?.target).toEqual({ _id: proposal._id });
      expect(listedPage?.target).toMatchObject({
        _id: pages.stale._id.toString(),
        path: pages.stale.path,
      });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(SECRET_BODY);
      expect(raw).not.toContain(pages.edited.path);
    });

    it('announces the new notification over Socket.IO only to recipients', async () => {
      const emitSocketIo = vi
        .spyOn(crowi.inAppNotificationService, 'emitSocketIo')
        .mockResolvedValue(undefined);
      const again = await storeProposal({ requester: users.requester }, [
        { input: editInput(pages.edited), status: 'applied' },
      ]);

      await createProposalNotifier(crowi).notifyApplied({
        proposal: again,
        activityId: new mongoose.Types.ObjectId().toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      });

      expect(emitSocketIo).toHaveBeenCalledTimes(1);
      expect(emitSocketIo).toHaveBeenCalledWith([
        users.subscriber._id.toString(),
      ]);
    });
  });

  describe('a revert proposal', () => {
    it('notifies the original requester as well, with the pages the revert deleted completely only for that requester', async () => {
      const deleted = await createPage('deleted-created');
      await Page.deleteOne({ _id: deleted._id });
      const publicEdited = await createPage('revert-edited-public');
      const groupEdited = await createPage(
        'revert-edited',
        PageGrant.GRANT_USER_GROUP,
      );
      await subscribe(users.subscriber, publicEdited);

      const original = await storeProposal({ requester: users.original }, [
        {
          input: { type: 'create', path: deleted.path, body: 'body' },
          status: 'reverted',
          resultPageId: deleted._id.toString(),
        },
        { input: editInput(publicEdited), status: 'reverted' },
        { input: editInput(groupEdited), status: 'reverted' },
      ]);
      const revert = await storeProposal(
        {
          requester: users.requester,
          entry: 'revert',
          revertOf: original._id,
        },
        [
          {
            input: {
              type: 'delete-completely',
              pageId: deleted._id.toString(),
              expectedRevisionId: new mongoose.Types.ObjectId().toString(),
              revertTarget: {
                proposalId: original._id,
                operationKey: original.operations[0].key,
              },
            },
            status: 'applied',
          },
          { input: editInput(publicEdited), status: 'applied' },
          { input: editInput(groupEdited), status: 'applied' },
        ],
      );

      await createProposalNotifier(crowi).notifyApplied({
        proposal: revert,
        activityId: new mongoose.Types.ObjectId().toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      });

      const notifications = await notificationsFor(revert._id);
      expect(notifications.map((n) => n.user.toString()).sort()).toEqual(
        [users.original._id, users.subscriber._id].map(String).sort(),
      );
      expect(
        notifications.every(
          (n) => n.action === SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
        ),
      ).toBe(true);

      // The original requester is outside the group, so the group page stays out;
      // the deleted page is named by the path that requester asked to create, and
      // the notification links to the original, which that requester can open.
      const forOriginal = snapshotOf(notifications, users.original);
      expect(forOriginal).toMatchObject({
        proposalId: original._id,
        entry: original.entry,
        kind: 'revert',
        requester: {
          id: users.requester._id.toString(),
          username: USERNAMES.requester,
        },
      });
      expect([...(forOriginal?.pages ?? [])].sort(byId)).toEqual(
        [
          { id: deleted._id.toString(), path: deleted.path },
          pageEntry(publicEdited),
        ].sort(byId),
      );
      // Content covers every target page the recipient can view, not only the
      // subscribed one, and never a deleted page.
      const forSubscriber = snapshotOf(notifications, users.subscriber);
      expect([...(forSubscriber?.pages ?? [])].sort(byId)).toEqual(
        [pageEntry(publicEdited), pageEntry(groupEdited)].sort(byId),
      );
      expect(forSubscriber).toMatchObject({
        proposalId: revert._id,
        entry: 'revert',
      });
    });

    it('notifies the original requester about a revert that only deleted a page they had created', async () => {
      const deleted = await createPage('only-deleted-created');
      await Page.deleteOne({ _id: deleted._id });
      const original = await storeProposal({ requester: users.original }, [
        {
          input: { type: 'create', path: deleted.path, body: 'body' },
          status: 'reverted',
          resultPageId: deleted._id.toString(),
        },
      ]);
      const revert = await storeProposal(
        {
          requester: users.requester,
          entry: 'revert',
          revertOf: original._id,
        },
        [
          {
            input: {
              type: 'delete-completely',
              pageId: deleted._id.toString(),
              expectedRevisionId: new mongoose.Types.ObjectId().toString(),
              revertTarget: {
                proposalId: original._id,
                operationKey: original.operations[0].key,
              },
            },
            status: 'applied',
          },
        ],
      );

      await createProposalNotifier(crowi).notifyApplied({
        proposal: revert,
        activityId: new mongoose.Types.ObjectId().toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      });

      const notifications = await notificationsFor(revert._id);
      expect(notifications.map((n) => n.user.toString())).toEqual([
        users.original._id.toString(),
      ]);
      expect(snapshotOf(notifications, users.original)?.pages).toEqual([
        { id: deleted._id.toString(), path: deleted.path },
      ]);
    });

    it('does not notify the reverter when the reverter is the original requester', async () => {
      const edited = await createPage('self-reverted');
      const original = await storeProposal({ requester: users.requester }, [
        { input: editInput(edited), status: 'reverted' },
      ]);
      const revert = await storeProposal(
        {
          requester: users.requester,
          entry: 'revert',
          revertOf: original._id,
        },
        [{ input: editInput(edited), status: 'applied' }],
      );

      await createProposalNotifier(crowi).notifyApplied({
        proposal: revert,
        activityId: new mongoose.Types.ObjectId().toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      });

      expect(await notificationsFor(revert._id)).toHaveLength(0);
    });
  });

  it('builds the same aggregated notification whether per-page notifications were sent or not', async () => {
    const page = await createPage('per-page-setting');
    await subscribe(users.subscriber, page);

    const notifyWith = async (perPage: boolean) => {
      await configManager.updateConfigs({
        'changeProposal:perPageNotificationsEnabled': perPage,
      });
      const proposal = await storeProposal(
        { requester: users.requester, perPageNotifications: perPage },
        [{ input: editInput(page), status: 'applied' }],
      );
      await createProposalNotifier(crowi).notifyApplied({
        proposal,
        activityId: new mongoose.Types.ObjectId().toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      });
      const notifications = await notificationsFor(proposal._id);
      return notifications.map((n) => {
        const { proposalId: _ignored, ...rest } = JSON.parse(n.snapshot);
        return { user: n.user.toString(), snapshot: rest };
      });
    };

    const sent = await notifyWith(true);
    const notSent = await notifyWith(false);

    expect(sent).toHaveLength(1);
    expect(notSent).toEqual(sent);
  });

  it('only logs when creating the notifications fails', async () => {
    const page = await createPage('insert-fails');
    await subscribe(users.subscriber, page);
    const proposal = await storeProposal({ requester: users.requester }, [
      { input: editInput(page), status: 'applied' },
    ]);
    vi.spyOn(InAppNotification, 'insertMany').mockRejectedValueOnce(
      new Error('insert failed'),
    );

    await expect(
      createProposalNotifier(crowi).notifyApplied({
        proposal,
        activityId: new mongoose.Types.ObjectId().toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      }),
    ).resolves.toBeUndefined();
  });
});
