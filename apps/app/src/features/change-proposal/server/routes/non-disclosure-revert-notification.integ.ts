import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant, SubscriptionStatusType } from '@growi/core';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import { setup as setupInAppNotificationRouter } from '~/server/routes/apiv3/in-app-notification';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalNotificationSnapshot,
  RevertResult,
} from '../../interfaces';
import { createChangeProposalService } from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.184';
const PREFIX = '/cp-non-disclosure-revert-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const NOTIFICATION_MOUNT_PATH = '/_api/v3/in-app-notification';
const BACKGROUND = { kind: 'background' } as const;
const NONE_USERNAME = 'cpNdRevertNone';

type PageTrio = {
  readonly shared: HydratedDocument<PageDocument>;
  readonly secret: HydratedDocument<PageDocument>;
  readonly linkOnly: HydratedDocument<PageDocument>;
};

const leakedOf = (value: unknown, secrets: readonly string[]): string[] => {
  const json = JSON.stringify(value);
  return secrets.filter((secret) => json.includes(secret));
};

describe('reverts and summary notifications never disclose pages a user cannot see', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpNdRevertRequester',
      // sees the shared group pages
      subscriber: 'cpNdRevertPartial',
      // sees only the secret group pages
      other: 'cpNdRevertOther',
    },
  });
  const { users } = kit;
  let noneUser: HydratedDocument<IUserHasId>;
  const groupIds: mongoose.Types.ObjectId[] = [];
  const revertProposalIds: string[] = [];
  const appliedProposalIds: string[] = [];
  let sharedGroup: mongoose.Types.ObjectId;
  let secretGroup: mongoose.Types.ObjectId;

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const createGroup = async (
    name: string,
    members: readonly IUserHasId[],
  ): Promise<mongoose.Types.ObjectId> => {
    const groupId = (await mongoose.model('UserGroup').create({ name }))._id;
    groupIds.push(groupId);
    await mongoose
      .model('UserGroupRelation')
      .insertMany(
        members.map((u) => ({ relatedGroup: groupId, relatedUser: u._id })),
      );
    return groupId;
  };

  const createPage = async (
    label: string,
    options: Record<string, unknown>,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      options,
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const groupGrant = (groupId: mongoose.Types.ObjectId) => ({
    grant: PageGrant.GRANT_USER_GROUP,
    grantUserGroupIds: [{ item: groupId, type: GroupType.userGroup }],
  });

  // Every non-requester subscribes to every page, so a missing notification
  // can only come from the visibility filter.
  const createSubscribedPages = async (label: string): Promise<PageTrio> => {
    const pages = {
      shared: await createPage(`${label}-shared`, groupGrant(sharedGroup)),
      secret: await createPage(`${label}-秘密　ページ（乙）`, {
        ...groupGrant(secretGroup),
      }),
      linkOnly: await createPage(`${label}-リンク限定　ページ`, {
        grant: PageGrant.GRANT_RESTRICTED,
      }),
    };
    await Promise.all(
      Object.values(pages).flatMap((page) =>
        [users.subscriber, users.other, noneUser].map((user) =>
          Subscription.subscribeByPageId(
            new Types.ObjectId(user._id),
            page._id,
            SubscriptionStatusType.SUBSCRIBE,
          ),
        ),
      ),
    );
    return pages;
  };

  const applyAll = async (pages: PageTrio): Promise<ChangeProposalDocument> => {
    const stored = await kit.storeProposal([
      kit.editInput(pages.shared, '共有の本文'),
      kit.editInput(pages.secret, '秘密の本文'),
      kit.editInput(pages.linkOnly, 'リンク限定の本文'),
    ]);
    await kit.newApplier().apply(stored._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    appliedProposalIds.push(stored._id);
    const applied = await kit.reload(stored._id);
    expect(applied.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    return applied;
  };

  const secretsOf = (
    pages: Pick<PageTrio, 'secret' | 'linkOnly'>,
    proposal: ChangeProposalDocument,
  ): string[] => [
    '秘密',
    'リンク限定',
    pages.secret.path,
    pages.secret._id.toString(),
    pages.linkOnly.path,
    pages.linkOnly._id.toString(),
    proposal.operations[1].key,
    proposal.operations[2].key,
  ];

  const snapshotsFor = async (
    proposalId: string,
  ): Promise<Map<string, ChangeProposalNotificationSnapshot[]>> => {
    const byUser = new Map<string, ChangeProposalNotificationSnapshot[]>();
    for (const n of await kit.aggregatedNotifications(proposalId)) {
      const user = String(n.user);
      byUser.set(user, [
        ...(byUser.get(user) ?? []),
        JSON.parse(n.snapshot) as ChangeProposalNotificationSnapshot,
      ]);
    }
    return byUser;
  };

  const pagesIn = (snapshots: ChangeProposalNotificationSnapshot[] = []) =>
    snapshots.map((s) => s.pages);

  const revert = (id: string, body: object = {}) =>
    request(app)
      .post(`${MOUNT_PATH}/${id}/revert`)
      .set('X-Forwarded-For', TEST_IP)
      .send(body);

  const keepRevertProposal = (result: RevertResult): string => {
    if (result.revertProposalId == null) throw new Error('nothing reverted');
    revertProposalIds.push(result.revertProposalId);
    return result.revertProposalId;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    noneUser = await mongoose.model<IUserHasId>('User').create({
      name: NONE_USERNAME,
      username: NONE_USERNAME,
      email: `${NONE_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
    sharedGroup = await createGroup('cpNdRevertShared', [
      users.requester,
      users.subscriber,
    ]);
    secretGroup = await createGroup('cpNdRevertSecret', [
      users.requester,
      users.other,
    ]);

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
    app.use(
      MOUNT_PATH,
      createChangeProposalRouter(crowi, {
        service: createChangeProposalService(crowi, {
          applier: kit.newApplier(),
        }),
      }),
    );
    app.use(NOTIFICATION_MOUNT_PATH, setupInAppNotificationRouter(crowi));
  }, 120_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await InAppNotification.deleteMany({
      target: { $in: revertProposalIds },
    });
    await prisma.activities.deleteMany({
      where: { target: { in: [...appliedProposalIds, ...revertProposalIds] } },
    });
    await prisma.changeproposals.deleteMany({
      where: { id: { in: revertProposalIds } },
    });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: { $in: groupIds } });
    await mongoose.model('UserGroup').deleteMany({ _id: { $in: groupIds } });
    await mongoose.model('User').deleteMany({ username: NONE_USERNAME });
    await kit.tearDown();
  }, 60_000);

  it('sends each subscriber a summary of only the pages they can open, and nothing to one who can open none', async () => {
    const pages = await createSubscribedPages('apply');
    const proposal = await applyAll(pages);

    const snapshots = await snapshotsFor(proposal._id);

    expect(pagesIn(snapshots.get(users.subscriber._id.toString()))).toEqual([
      [{ id: pages.shared._id.toString(), path: pages.shared.path }],
    ]);
    // Positive control: the secret page does reach the one who can open it.
    expect(pagesIn(snapshots.get(users.other._id.toString()))).toEqual([
      [{ id: pages.secret._id.toString(), path: pages.secret.path }],
    ]);
    expect(snapshots.has(noneUser._id.toString())).toBe(false);
    expect(snapshots.has(users.requester._id.toString())).toBe(false);
    expect(
      leakedOf(snapshots.get(users.subscriber._id.toString()), [
        ...secretsOf(pages, proposal),
        proposal.operations[0].key,
      ]),
    ).toEqual([]);
  });

  it('serves the notification list without the proposal or any hidden page', async () => {
    const pages = await createSubscribedPages('list');
    const proposal = await applyAll(pages);

    asUser(users.subscriber);
    const partial = await request(app)
      .get(`${NOTIFICATION_MOUNT_PATH}/list`)
      .query({ limit: 50 });
    asUser(noneUser);
    const none = await request(app)
      .get(`${NOTIFICATION_MOUNT_PATH}/list`)
      .query({ limit: 50 });

    expect(partial.status).toBe(200);
    const doc = partial.body.docs.find(
      (d: { target: { _id: string } }) => d.target._id === proposal._id,
    );
    expect(doc.target).toEqual({ _id: proposal._id });
    expect(JSON.stringify(partial.body)).toContain(pages.shared.path);
    expect(leakedOf(partial.body, secretsOf(pages, proposal))).toEqual([]);
    expect(none.status).toBe(200);
    expect(leakedOf(none.body, [proposal._id, pages.shared.path])).toEqual([]);
  });

  describe('POST /:id/revert by a partial viewer', () => {
    let pages: PageTrio;
    let proposal: ChangeProposalDocument;

    beforeAll(async () => {
      pages = await createSubscribedPages('partial-revert');
      proposal = await applyAll(pages);
    });

    it('treats the key of a hidden operation exactly like an unknown key', async () => {
      asUser(users.subscriber);

      const responses = await Promise.all([
        revert(proposal._id, { operationKeys: [proposal.operations[1].key] }),
        revert(proposal._id, { operationKeys: [proposal.operations[2].key] }),
        revert(proposal._id, { operationKeys: [randomUUID()] }),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual(responses[2].body);
      }
      expect(responses[2].body).toEqual({ result: { operations: [] } });
    });

    it('answers a user who can see nothing exactly like a missing or malformed id', async () => {
      const cases: [IUserHasId, string][] = [
        [noneUser, proposal._id],
        [noneUser, new Types.ObjectId().toString()],
        [users.subscriber, new Types.ObjectId().toString()],
        [users.subscriber, 'not-an-object-id'],
      ];

      const responses: request.Response[] = [];
      for (const [user, id] of cases) {
        asUser(user);
        // biome-ignore lint/performance/noAwaitInLoops: the user is switched per request
        responses.push(await revert(id));
      }

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
    });

    it('reverts only the visible operation, says nothing of the rest, and notifies the original requester of that page only', async () => {
      asUser(users.subscriber);

      const res = await revert(proposal._id);

      expect(res.status).toBe(200);
      const result: RevertResult = res.body.result;
      const revertProposalId = keepRevertProposal(result);
      expect(result.operations).toEqual([
        { key: proposal.operations[0].key, outcome: 'reverted' },
      ]);
      expect(leakedOf(res.body, secretsOf(pages, proposal))).toEqual([]);

      const snapshots = await snapshotsFor(revertProposalId);
      expect([...snapshots.keys()]).toEqual([users.requester._id.toString()]);
      expect(pagesIn(snapshots.get(users.requester._id.toString()))).toEqual([
        [{ id: pages.shared._id.toString(), path: pages.shared.path }],
      ]);
      const after = await kit.reload(proposal._id);
      expect(after.operations.map((op) => op.status)).toEqual([
        'reverted',
        'applied',
        'applied',
      ]);
    });
  });

  it('notifies each subscriber of a requester’s full revert with only the pages they can open', async () => {
    const pages = await createSubscribedPages('full-revert');
    const proposal = await applyAll(pages);
    asUser(users.requester);

    const res = await revert(proposal._id);

    expect(res.status).toBe(200);
    const result: RevertResult = res.body.result;
    expect(result.operations.map((op) => op.outcome)).toEqual([
      'reverted',
      'reverted',
      'reverted',
    ]);
    const snapshots = await snapshotsFor(keepRevertProposal(result));
    expect(pagesIn(snapshots.get(users.subscriber._id.toString()))).toEqual([
      [{ id: pages.shared._id.toString(), path: pages.shared.path }],
    ]);
    expect(pagesIn(snapshots.get(users.other._id.toString()))).toEqual([
      [{ id: pages.secret._id.toString(), path: pages.secret.path }],
    ]);
    expect(snapshots.has(noneUser._id.toString())).toBe(false);
    expect(snapshots.get(users.subscriber._id.toString())?.[0].kind).toBe(
      'revert',
    );
  });
});
