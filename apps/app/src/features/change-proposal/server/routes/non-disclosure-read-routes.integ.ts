import type { IUserHasId } from '@growi/core';
import { GroupType, getIdStringForRef, PageGrant } from '@growi/core';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalSummaryView,
  ChangeProposalView,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.183';
const PREFIX = '/cp-non-disclosure-read-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
// Same routes over a one-document scan budget, so a page can end on a hidden proposal.
const TINY_SCAN_MOUNT_PATH = '/_api/v3/cp-tiny-scan';
const BACKGROUND = { kind: 'background' } as const;
const NONE_USERNAME = 'cpNdReadNone';
const T1 = new Date(Date.now() - 2 * 60 * 60 * 1000);
const T2 = new Date(Date.now() - 60 * 60 * 1000);

const leakedOf = (value: unknown, secrets: readonly string[]): string[] => {
  const json = JSON.stringify(value);
  return secrets.filter((secret) => json.includes(secret));
};

const missingOf = (value: unknown, secrets: readonly string[]): string[] => {
  const json = JSON.stringify(value);
  return secrets.filter((secret) => !json.includes(secret));
};

describe('change proposals never disclose pages a viewer cannot see (read routes)', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpNdReadRequester',
      // sees the group pages shared with the requester
      subscriber: 'cpNdReadPartial',
      // sees only the pages of a second group
      other: 'cpNdReadOther',
    },
  });
  const { users } = kit;
  let noneUser: HydratedDocument<IUserHasId>;
  const groupIds: mongoose.Types.ObjectId[] = [];

  let pageA: HydratedDocument<PageDocument>;
  let pageB: HydratedDocument<PageDocument>;
  let pageC: HydratedDocument<PageDocument>;
  let pendingPage: HydratedDocument<PageDocument>;
  let stalePage: HydratedDocument<PageDocument>;
  let skippedPage: HydratedDocument<PageDocument>;
  let failedPage: HydratedDocument<PageDocument>;
  let hiddenOnlyPage: HydratedDocument<PageDocument>;
  let linkOnlyPage: HydratedDocument<PageDocument>;
  let lostPage: HydratedDocument<PageDocument>;
  let lostGroupId: mongoose.Types.ObjectId;

  let main: ChangeProposalDocument;
  let linkOnly: ChangeProposalDocument;
  let pendingOnly: ChangeProposalDocument;
  let hiddenOnly: ChangeProposalDocument;
  let lost: ChangeProposalDocument;
  let key: Record<
    'A' | 'B' | 'C' | 'pending' | 'stale' | 'skipped' | 'failed',
    string
  >;
  let rev: Record<'A' | 'B' | 'C' | 'hiddenOnly' | 'linkOnly' | 'lost', string>;
  // What the partial viewer must never read anywhere.
  let hiddenFromPartial: string[];

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

  const createPageAs = async (
    label: string,
    grant:
      | { grant: typeof PageGrant.GRANT_RESTRICTED }
      | { groupId: mongoose.Types.ObjectId },
  ): Promise<HydratedDocument<PageDocument>> => {
    const options =
      'groupId' in grant
        ? {
            grant: PageGrant.GRANT_USER_GROUP,
            grantUserGroupIds: [
              { item: grant.groupId, type: GroupType.userGroup },
            ],
          }
        : grant;
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      options,
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const serviceAt = (at: Date): ChangeProposalService =>
    createChangeProposalService(crowi, {
      applier: kit.newApplier({ now: () => at }),
    });

  const applyNow = async (
    proposal: ChangeProposalDocument,
  ): Promise<ChangeProposalDocument> => {
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const resultRevisionOf = (
    proposal: ChangeProposalDocument,
    opKey: string,
  ): string => {
    const op = kit.operationOf(proposal, opKey);
    if (op.resultRevisionId == null) throw new Error(`${opKey} not applied`);
    return op.resultRevisionId;
  };

  const getProposal = (id: string) => request(app).get(`${MOUNT_PATH}/${id}`);
  const listApplied = (query: Record<string, unknown> = { limit: 50 }) =>
    request(app).get(`${MOUNT_PATH}/applied`).query(query);
  const postMarks = (revisionIds: readonly string[]) =>
    request(app).post(`${MOUNT_PATH}/revision-marks`).send({ revisionIds });

  const idsOf = (items: readonly ChangeProposalSummaryView[]): string[] =>
    items.map((item) => item.id);

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

    const sharedGroup = await createGroup('cpNdReadShared', [
      users.requester,
      users.subscriber,
    ]);
    const secretGroup = await createGroup('cpNdReadSecret', [
      users.requester,
      users.other,
    ]);
    lostGroupId = await createGroup('cpNdReadLost', [
      users.requester,
      users.subscriber,
    ]);

    pageA = await createPageAs('shared-a', { groupId: sharedGroup });
    pendingPage = await createPageAs('shared-pending', {
      groupId: sharedGroup,
    });
    stalePage = await createPageAs('shared-stale', { groupId: sharedGroup });
    skippedPage = await createPageAs('shared-skipped', {
      groupId: sharedGroup,
    });
    failedPage = await createPageAs('shared-failed', {
      groupId: sharedGroup,
    });
    pageB = await createPageAs('秘密　ページ（乙）', { groupId: secretGroup });
    hiddenOnlyPage = await createPageAs('秘密　だけ', { groupId: secretGroup });
    pageC = await createPageAs('リンク限定　ページ', {
      grant: PageGrant.GRANT_RESTRICTED,
    });
    linkOnlyPage = await createPageAs('リンク限定　だけ', {
      grant: PageGrant.GRANT_RESTRICTED,
    });
    lostPage = await createPageAs('失う　ページ', { groupId: lostGroupId });

    const stored = await kit.storeProposal(
      [
        kit.editInput(pageA, '共有の本文'),
        kit.editInput(pageB, '秘密の本文'),
        kit.editInput(pageC, 'リンク限定の本文'),
        kit.editInput(pendingPage),
        // A base revision that is not the page's latest makes the edit stale.
        {
          type: 'edit',
          pageId: stalePage._id.toString(),
          baseRevisionId: new Types.ObjectId().toString(),
          body: 'stale body',
        },
        kit.editInput(skippedPage),
        // Moving onto an occupied path makes the move fail.
        {
          type: 'move',
          pageId: failedPage._id.toString(),
          fromPath: failedPage.path,
          toPath: pageA.path,
        },
      ],
      { approve: false },
    );
    const [A, B, C, pending, stale, skipped, failed] = stored.operations.map(
      (op) => op.key,
    );
    key = { A, B, C, pending, stale, skipped, failed };
    const requesterService = serviceAt(T2);
    // A is applied alone and earlier, so the stored lastAppliedAt belongs to hidden operations.
    for (const [service, keys] of [
      [serviceAt(T1), [A]],
      [requesterService, [B, C, stale, failed]],
    ] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: the two approvals must run in order
      const approved = await service.approve(
        stored._id,
        users.requester,
        keys,
        BACKGROUND,
      );
      if (!approved.ok) throw new Error(JSON.stringify(approved.error));
      await kit.waitForPageOperationsToFinish();
    }
    const skippedResult = await requesterService.skip(
      stored._id,
      users.requester,
      [skipped],
    );
    if (!skippedResult.ok) throw new Error(JSON.stringify(skippedResult));
    main = await kit.reload(stored._id);
    expect(main.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'pending',
      'stale',
      'skipped',
      'failed',
    ]);
    expect(main.lastAppliedAt?.getTime()).toBe(T2.getTime());

    linkOnly = await applyNow(
      await kit.storeProposal([kit.editInput(linkOnlyPage)]),
    );
    hiddenOnly = await applyNow(
      await kit.storeProposal([kit.editInput(hiddenOnlyPage)]),
    );
    pendingOnly = await kit.storeProposal(
      [kit.editInput(await kit.findPage(pageA._id))],
      { approve: false },
    );
    lost = await applyNow(await kit.storeProposal([kit.editInput(lostPage)]));

    rev = {
      A: resultRevisionOf(main, A),
      B: resultRevisionOf(main, B),
      C: resultRevisionOf(main, C),
      hiddenOnly: resultRevisionOf(hiddenOnly, hiddenOnly.operations[0].key),
      linkOnly: resultRevisionOf(linkOnly, linkOnly.operations[0].key),
      lost: resultRevisionOf(lost, lost.operations[0].key),
    };
    const pathAndId = (page: HydratedDocument<PageDocument>) => [
      page.path,
      page._id.toString(),
    ];
    hiddenFromPartial = [
      '秘密',
      'リンク限定',
      ...pathAndId(pageB),
      ...pathAndId(pageC),
      ...pathAndId(pendingPage),
      ...pathAndId(stalePage),
      ...pathAndId(skippedPage),
      ...pathAndId(failedPage),
      key.B,
      key.C,
      key.pending,
      key.stale,
      key.skipped,
      key.failed,
      rev.B,
      rev.C,
      getIdStringForRef(pageB.revision ?? ''),
      getIdStringForRef(pageC.revision ?? ''),
      T2.toISOString(),
    ];

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app = express();
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
      createChangeProposalRouter(crowi, { service: requesterService }),
    );
    app.use(
      TINY_SCAN_MOUNT_PATH,
      createChangeProposalRouter(crowi, {
        service: createChangeProposalService(crowi, {
          applier: kit.newApplier(),
          appliedListScan: { batchSize: 1, limit: 1 },
        }),
      }),
    );
  }, 180_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const proposalIds = [main, linkOnly, pendingOnly, hiddenOnly, lost].map(
      (p) => p._id,
    );
    await prisma.activities.deleteMany({
      where: { target: { in: proposalIds } },
    });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: { $in: groupIds } });
    await mongoose.model('UserGroup').deleteMany({ _id: { $in: groupIds } });
    await mongoose.model('User').deleteMany({ username: NONE_USERNAME });
    await kit.tearDown();
  }, 60_000);

  describe('GET /:id', () => {
    it('shows the requester every operation, the stage and the achievement (positive control)', async () => {
      asUser(users.requester);

      const res = await getProposal(main._id);

      expect(res.status).toBe(200);
      const proposal: ChangeProposalView = res.body.proposal;
      expect(proposal.status).toBe('pending');
      expect(proposal.lastAppliedAt).toBe(T2.toISOString());
      expect(proposal.requesterState?.lifecycle).toBe('open');
      expect(proposal.requesterState?.achievement).toEqual({
        applied: 3,
        attempted: 6,
      });
      expect(proposal.operations.map((op) => op.index)).toEqual([
        0, 1, 2, 3, 4, 5, 6,
      ]);
      expect(missingOf(res.body, hiddenFromPartial)).toEqual([]);
    });

    it('shows a partial viewer only their applied operation, dated by it, with no stage, achievement or hint of the rest', async () => {
      asUser(users.subscriber);

      const res = await getProposal(main._id);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['proposal']);
      const proposal: ChangeProposalView = res.body.proposal;
      expect(Object.keys(proposal).sort()).toEqual([
        'createdAt',
        'entry',
        'id',
        'isRequester',
        'lastAppliedAt',
        'operations',
        'requester',
        'status',
      ]);
      expect(proposal.status).toBe('applied');
      expect(proposal.lastAppliedAt).toBe(T1.toISOString());
      expect(proposal.operations).toHaveLength(1);
      expect(proposal.operations[0]).toMatchObject({
        key: key.A,
        status: 'applied',
        appliedAt: T1.toISOString(),
        page: { id: pageA._id.toString(), path: pageA.path },
        resultRevisionId: rev.A,
      });
      expect(proposal.operations[0]).not.toHaveProperty('index');
      expect(proposal.operations[0]).not.toHaveProperty('proposedBody');
      expect(leakedOf(res.body, hiddenFromPartial)).toEqual([]);
    });

    it('shows the other partial viewer only the operation on their own group page', async () => {
      asUser(users.other);

      const res = await getProposal(main._id);

      expect(res.status).toBe(200);
      const proposal: ChangeProposalView = res.body.proposal;
      expect(proposal.operations.map((op) => op.key)).toEqual([key.B]);
      expect(proposal.lastAppliedAt).toBe(T2.toISOString());
      expect(proposal.requesterState).toBeUndefined();
      expect(
        leakedOf(res.body, [
          pageA.path,
          pageA._id.toString(),
          pageC.path,
          key.A,
          key.C,
          key.pending,
          rev.A,
          T1.toISOString(),
        ]),
      ).toEqual([]);
    });

    it('answers nothing visible exactly like a missing or malformed id, for every viewer', async () => {
      const cases: [IUserHasId, string][] = [
        [users.subscriber, new Types.ObjectId().toString()],
        [users.subscriber, 'not-an-object-id'],
        [users.subscriber, `${main._id}x`],
        [users.subscriber, linkOnly._id],
        [users.subscriber, pendingOnly._id],
        [users.subscriber, hiddenOnly._id],
        [users.other, linkOnly._id],
        [users.other, pendingOnly._id],
        [noneUser, main._id],
        [noneUser, linkOnly._id],
        [noneUser, hiddenOnly._id],
        [noneUser, new Types.ObjectId().toString()],
      ];

      const responses: request.Response[] = [];
      for (const [user, id] of cases) {
        asUser(user);
        // biome-ignore lint/performance/noAwaitInLoops: the viewer is switched per request
        responses.push(await getProposal(id));
      }

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
      expect(responses[0].body.errors[0].code).toBe('notfound');
    });
  });

  describe('GET /mine', () => {
    it('lists the requester’s proposals with their own stage, and nothing for anyone else', async () => {
      asUser(users.requester);
      const mine = await request(app)
        .get(`${MOUNT_PATH}/mine`)
        .query({ limit: 50 });
      const summary = mine.body.items.find(
        (item: ChangeProposalSummaryView) => item.id === main._id,
      );
      expect(summary.requesterState.achievement).toEqual({
        applied: 3,
        attempted: 6,
      });

      for (const user of [users.subscriber, users.other, noneUser]) {
        asUser(user);
        // biome-ignore lint/performance/noAwaitInLoops: the viewer is switched per request
        const res = await request(app).get(`${MOUNT_PATH}/mine`);
        expect(res.body).toEqual({ items: [], hasNext: false });
      }
    });
  });

  describe('GET /applied', () => {
    it('gives the partial viewer the proposal with only their page and their date, and nothing of the hidden ones', async () => {
      asUser(users.subscriber);

      const res = await listApplied();

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['items', 'nextCursor']);
      const items: ChangeProposalSummaryView[] = res.body.items;
      const ids = idsOf(items);
      expect(ids).toContain(main._id);
      for (const hidden of [linkOnly, hiddenOnly, pendingOnly]) {
        expect(ids).not.toContain(hidden._id);
      }
      const summary = items.find((item) => item.id === main._id);
      expect(summary).toMatchObject({
        status: 'applied',
        lastAppliedAt: T1.toISOString(),
        pages: [{ id: pageA._id.toString(), path: pageA.path }],
      });
      expect(summary).not.toHaveProperty('requesterState');
      expect(
        leakedOf(res.body, [
          ...hiddenFromPartial,
          linkOnly._id,
          hiddenOnly._id,
          linkOnlyPage.path,
          hiddenOnlyPage.path,
        ]),
      ).toEqual([]);
    });

    it('lists none of these proposals to a viewer who can see none of their pages', async () => {
      asUser(noneUser);

      const res = await listApplied();

      expect(res.status).toBe(200);
      const ids = idsOf(res.body.items);
      for (const proposal of [main, linkOnly, hiddenOnly, lost]) {
        expect(ids).not.toContain(proposal._id);
      }
      expect(
        leakedOf(res.body, [
          ...hiddenFromPartial,
          pageA.path,
          linkOnlyPage.path,
          hiddenOnlyPage.path,
        ]),
      ).toEqual([]);
    });

    it('lists the hidden ones to the requester who can see them (positive control)', async () => {
      asUser(users.requester);

      const res = await listApplied();

      expect(idsOf(res.body.items)).toEqual(
        expect.arrayContaining([main._id, linkOnly._id, hiddenOnly._id]),
      );
    });

    it('never returns a hidden proposal, and the id a cursor stops at answers 404 like any unknown id', async () => {
      asUser(users.subscriber);
      const returned: string[] = [];
      const cursorIds: string[] = [];
      let emptyPagesWithCursor = 0;
      let cursor: string | undefined;
      for (let round = 0; round < 200; round++) {
        // biome-ignore lint/performance/noAwaitInLoops: each page starts at the previous cursor
        const res = await request(app)
          .get(`${TINY_SCAN_MOUNT_PATH}/applied`)
          .query(cursor == null ? { limit: 1 } : { limit: 1, cursor });
        expect(res.status).toBe(200);
        returned.push(...idsOf(res.body.items));
        if (res.body.nextCursor == null) break;
        if (res.body.items.length === 0) emptyPagesWithCursor += 1;
        cursor = res.body.nextCursor as string;
        cursorIds.push(cursor.split('-')[1]);
      }

      expect(returned.filter((id) => id === main._id)).toHaveLength(1);
      for (const hidden of [linkOnly, hiddenOnly, pendingOnly]) {
        expect(returned).not.toContain(hidden._id);
      }
      // The cursor is the position of the last document scanned (design 6.2):
      // it may name a hidden proposal, which must then read exactly as unknown.
      const unknown = await getProposal(new Types.ObjectId().toString());
      const hiddenCursorIds = cursorIds.filter((id) => !returned.includes(id));
      // The scan did stop on hidden proposals, so the check below is not vacuous.
      expect(emptyPagesWithCursor).toBeGreaterThan(0);
      for (const id of hiddenCursorIds) {
        // biome-ignore lint/performance/noAwaitInLoops: one id at a time keeps the failure readable
        const res = await getProposal(id);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(unknown.body);
      }
    });
  });

  describe('POST /revision-marks', () => {
    it('marks only the revision of the visible operation; a hidden revision reads like an unknown one', async () => {
      asUser(users.subscriber);
      const unknownId = new Types.ObjectId().toString();

      const res = await postMarks([
        rev.B,
        rev.A,
        rev.C,
        rev.hiddenOnly,
        rev.linkOnly,
        unknownId,
      ]);
      const hiddenOnlyRes = await postMarks([rev.B]);
      const unknownOnlyRes = await postMarks([unknownId]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        marks: [{ revisionId: rev.A, proposalId: main._id, isRevert: false }],
      });
      expect(hiddenOnlyRes.status).toBe(unknownOnlyRes.status);
      expect(hiddenOnlyRes.body).toEqual(unknownOnlyRes.body);
    });

    it('marks nothing for a viewer who can see none of the pages, and every revision for the requester', async () => {
      const all = [rev.A, rev.B, rev.C, rev.hiddenOnly, rev.linkOnly];
      asUser(noneUser);
      const none = await postMarks(all);
      asUser(users.requester);
      const requester = await postMarks(all);

      expect(none.body).toEqual({ marks: [] });
      expect(
        requester.body.marks.map((m: { revisionId: string }) => m.revisionId),
      ).toEqual(all);
    });
  });

  // Last: it takes the partial viewer out of a group for good.
  describe('a viewer who lost access after the apply', () => {
    it('reads the proposal, its listing and its mark exactly as if it never existed', async () => {
      asUser(users.subscriber);
      const before = await getProposal(lost._id);
      expect(before.status).toBe(200);
      expect((await postMarks([rev.lost])).body.marks).toHaveLength(1);

      await mongoose.model('UserGroupRelation').deleteMany({
        relatedGroup: lostGroupId,
        relatedUser: users.subscriber._id,
      });

      const after = await getProposal(lost._id);
      const unknown = await getProposal(new Types.ObjectId().toString());
      const applied = await listApplied();
      const marks = await postMarks([rev.lost]);
      expect(after.status).toBe(404);
      expect(after.body).toEqual(unknown.body);
      expect(idsOf(applied.body.items)).not.toContain(lost._id);
      expect(
        leakedOf(applied.body, [lostPage.path, lostPage._id.toString()]),
      ).toEqual([]);
      expect(marks.body).toEqual({ marks: [] });
    });
  });
});
