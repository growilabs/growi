import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument, Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import { createReviewerRoutesTestKit } from './reviewer-routes.test-kit';

const PREFIX = '/cp-nd-reviewer-routes-integ';
const PURPOSE = 'why this change';
const HIDDEN_COMMENT = 'COMMENT-ON-A-PAGE-THE-REVIEWER-CANNOT-VIEW';
const PEER_WHOLE_COMMENT = 'WHOLE-REJECTION-BY-THE-PEER';
const OWN_WHOLE_COMMENT = 'WHOLE-REJECTION-BY-THE-REVIEWER';
const LOST_COMMENT = 'COMMENT-ON-A-PAGE-THE-REQUESTER-CANNOT-VIEW';
const SHARED_COMMENT = 'COMMENT-ON-A-SHARED-PAGE';

const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const OBJECT_ID = /\b[0-9a-f]{24}\b/g;
const PAGE_PATH = new RegExp(`${PREFIX}(?:/[\\w-]+)+`, 'g');

// What a body says once ids, keys, paths and times are numbered by first
// appearance: two proposals a viewer cannot tell apart reduce to the same value.
const shapeOf = (value: unknown): unknown => {
  const seen = new Map<string, string>();
  const numbered = (kind: string) => (match: string) => {
    const known = seen.get(match);
    if (known != null) return known;
    const placeholder = `<${kind}-${seen.size}>`;
    seen.set(match, placeholder);
    return placeholder;
  };
  return JSON.parse(
    JSON.stringify(value)
      .replace(ISO_DATE, '<date>')
      .replace(UUID, numbered('key'))
      .replace(PAGE_PATH, numbered('path'))
      .replace(OBJECT_ID, numbered('id')),
  );
};

describe('reviewer routes never disclose operations a viewer cannot see', () => {
  const t = createReviewerRoutesTestKit({
    prefix: PREFIX,
    ip: '10.0.0.195',
    usernameBase: 'cpNdReviewerRoutes',
  });
  const { kit, users, fixtures, asUser, idOf, storedRef, userInput } = t;
  // users.subscriber is the reviewer who sees some pages only; fixtures.addedUser
  // is a peer reviewer who, like the requester, belongs to the group of the
  // hidden pages; users.other is unrelated to every proposal here.
  const peer = () => fixtures.addedUser;
  const reviewer = () => users.subscriber;
  const stranger = () => users.other;
  let crowi: Crowi;
  let groupId: Types.ObjectId;

  const edit = (page: HydratedDocument<PageDocument>) => kit.editInput(page);

  const pageBy = async (
    label: string,
    creator: IUserHasId,
    options: Parameters<Crowi['pageService']['create']>[3],
  ) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      creator,
      options,
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  // Viewable by the requester and the peer, never by the reviewer.
  const groupPage = (label: string) =>
    pageBy(label, users.requester, {
      grant: PageGrant.GRANT_USER_GROUP,
      grantUserGroupIds: [{ item: groupId, type: GroupType.userGroup }],
    });

  const store = (
    operations: readonly CreateOperationInput[],
    reviewers: readonly IUserHasId[],
  ) =>
    kit.storeProposal(operations, {
      approve: false,
      purpose: PURPOSE,
      reviewers: reviewers.map((u) => storedRef(userInput(u))),
    });

  const keysOf = (proposal: ChangeProposalDocument) =>
    proposal.operations.map((op) => op.key);

  const notificationsOf = async (user: IUserHasId, proposalId: string) =>
    (
      await InAppNotification.find({ user: user._id, target: proposalId })
        .sort({ _id: 1 })
        .lean()
        .exec()
    ).map((n) => ({ action: n.action, snapshot: JSON.parse(n.snapshot) }));

  const as = <T>(user: IUserHasId, act: () => Promise<T>): Promise<T> => {
    asUser(user);
    return act();
  };

  // The same request against two proposals, reduced to what the caller reads.
  const shapesOf = (
    res: readonly { status: number; body: unknown }[],
  ): unknown[] => res.map((r) => shapeOf({ status: r.status, body: r.body }));

  // X has a pending edit on a page the reviewer cannot view between two it can;
  // Y is the same proposal without it. The reviewer joins both the same way.
  const twins = async (label: string) => {
    const x = await store(
      [
        edit(await kit.createPage(`${label}-x-first`)),
        edit(await groupPage(`${label}-x-hidden`)),
        edit(await kit.createPage(`${label}-x-second`)),
      ],
      [peer()],
    );
    const y = await store(
      [
        edit(await kit.createPage(`${label}-y-first`)),
        edit(await kit.createPage(`${label}-y-second`)),
      ],
      [peer()],
    );
    const [xFirst, xHidden, xSecond] = keysOf(x);
    const [yFirst, ySecond] = keysOf(y);
    for (const proposal of [x, y]) {
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time keeps the twins in step
      const res = await as(users.requester, () =>
        t.patchReviewers(proposal._id, { add: [userInput(reviewer())] }),
      );
      expect(res.status).toBe(204);
    }
    return {
      x: { id: x._id, first: xFirst, hidden: xHidden, second: xSecond },
      y: { id: y._id, first: yFirst, second: ySecond },
    };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    groupId = (
      await mongoose.model('UserGroup').create({ name: 'cpNdReviewerGroup' })
    )._id;
    await mongoose.model('UserGroupRelation').insertMany(
      [users.requester, fixtures.addedUser].map((u) => ({
        relatedGroup: groupId,
        relatedUser: u._id,
      })),
    );
  });

  afterAll(async () => {
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: groupId });
    await mongoose.model('UserGroup').deleteMany({ _id: groupId });
    await prisma.activities.deleteMany({
      where: { userId: idOf(fixtures.addedUser) },
    });
  });

  describe('the reviewer, who sees some of the pages', () => {
    it('reads the proposal and the review request exactly as one without the hidden operation, records on it included (Reviewers Req 3.8, 5.6, 5.7, 6.3)', async () => {
      const { x, y } = await twins('read');
      const peerAnswers = await as(peer(), async () => [
        await t.postReview(x.id, {
          kind: 'reject',
          operationKeys: [x.hidden],
          comment: HIDDEN_COMMENT,
        }),
        await t.postReview(x.id, {
          kind: 'reject',
          comment: PEER_WHOLE_COMMENT,
        }),
        await t.postReview(y.id, {
          kind: 'reject',
          comment: PEER_WHOLE_COMMENT,
        }),
      ]);
      expect(peerAnswers.map((res) => res.status)).toEqual([200, 200, 200]);

      const [readX, readY] = await as(reviewer(), async () => [
        await t.getProposal(x.id),
        await t.getProposal(y.id),
      ]);

      expect(readX.status).toBe(200);
      expect(shapesOf([readX])).toEqual(shapesOf([readY]));
      expect(
        readX.body.proposal.operations.map((op: { key: string }) => op.key),
      ).toEqual([x.first, x.second]);
      expect(shapeOf(await notificationsOf(reviewer(), x.id))).toEqual(
        shapeOf(await notificationsOf(reviewer(), y.id)),
      );
      expect(await notificationsOf(reviewer(), x.id)).toHaveLength(1);
      const seen = JSON.stringify([
        readX.body,
        await notificationsOf(reviewer(), x.id),
      ]);
      for (const secret of [x.hidden, HIDDEN_COMMENT, PEER_WHOLE_COMMENT]) {
        expect(seen).not.toContain(secret);
      }
    });

    it('gets the same answers to its rejections, abstention and approval, and leaves the same activities, when it names the hidden operation (Reviewers Req 2.6, 5.6, 6.8)', async () => {
      const { x, y } = await twins('decide');
      const absentKey = randomUUID();

      const answers = await as(reviewer(), async () => {
        const run = async (id: string, keys: readonly string[]) => [
          await t.postReview(id, {
            kind: 'reject',
            operationKeys: keys.slice(0, 2),
            comment: SHARED_COMMENT,
          }),
          await t.postReview(id, {
            kind: 'abstain',
            operationKeys: keys.slice(2),
          }),
          await t.postReview(id, {
            kind: 'reject',
            comment: OWN_WHOLE_COMMENT,
          }),
          await t.postAction(id, 'approve', {
            operationKeys: keys.slice(0, 2),
          }),
        ];
        return {
          x: await run(x.id, [x.first, x.hidden, x.second]),
          y: await run(y.id, [y.first, absentKey, y.second]),
        };
      });

      expect(answers.x.map((res) => res.status)).toEqual([200, 200, 200, 200]);
      expect(shapesOf(answers.x)).toEqual(shapesOf(answers.y));
      expect(JSON.stringify(answers.x.map((r) => r.body))).not.toContain(
        x.hidden,
      );
      const reviewerActionsOf = async (id: string) =>
        (
          await prisma.activities.findMany({
            where: { target: id, userId: idOf(reviewer()) },
          })
        )
          .map((row) => row.action)
          .sort();
      const oneRowPerRequest = [
        SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN,
        SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE,
        SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
        SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
      ];
      await vi.waitFor(
        async () => {
          expect(await reviewerActionsOf(x.id)).toEqual(oneRowPerRequest);
          expect(await reviewerActionsOf(y.id)).toEqual(oneRowPerRequest);
        },
        { timeout: 5000, interval: 50 },
      );
      const rows = await prisma.activities.findMany({
        where: { target: x.id },
      });
      expect(JSON.stringify(rows)).not.toContain(x.hidden);
    });

    it('meets a proposal whose visible operations are settled as closed, though a hidden one is still pending (Reviewers Req 2.9, 5.6)', async () => {
      const { x, y } = await twins('settled');
      await as(reviewer(), async () => {
        expect((await t.postAction(x.id, 'approve')).status).toBe(200);
        expect((await t.postAction(y.id, 'approve')).status).toBe(200);
      });
      expect((await kit.reload(x.id)).lifecycle).toBe('open');

      const afterwards = await as(reviewer(), async () => {
        const run = async (id: string) => [
          await t.getProposal(id),
          await t.postAction(id, 'approve'),
          await t.postReview(id, { kind: 'reject' }),
          await t.patchReviewers(id, { add: [userInput(stranger())] }),
        ];
        return { x: await run(x.id), y: await run(y.id) };
      });

      expect(afterwards.x.map((res) => res.status)).toEqual([
        200, 409, 409, 409,
      ]);
      expect(shapesOf(afterwards.x)).toEqual(shapesOf(afterwards.y));
    });

    it('does not let approving a visible edit pull in a move of the same page under a parent it cannot view (Reviewers Req 2.6, 5.6)', async () => {
      const page = await kit.createPage('grouped-edit');
      const hiddenParent = await groupPage('grouped-hidden-parent');
      const x = await store(
        [
          edit(page),
          {
            type: 'move',
            pageId: page._id.toString(),
            fromPath: page.path,
            toPath: `${hiddenParent.path}/moved`,
          },
        ],
        [reviewer()],
      );
      const y = await store(
        [edit(await kit.createPage('grouped-twin'))],
        [reviewer()],
      );
      const [editKey, moveKey] = keysOf(x);

      const [approveX, approveY] = await as(reviewer(), async () => [
        await t.postAction(x._id, 'approve', { operationKeys: [editKey] }),
        await t.postAction(y._id, 'approve', {
          operationKeys: keysOf(y),
        }),
      ]);

      expect(approveX.body.result).toEqual({
        type: 'done',
        results: [{ key: editKey, status: 'applied' }],
      });
      expect(shapesOf([approveX])).toEqual(shapesOf([approveY]));
      const move = kit.operationOf(await kit.reload(x._id), moveKey);
      expect([move.status, move.approvedAt ?? null]).toEqual(['pending', null]);
    });

    it('never finds, while paging the queue honestly, a proposal it is named on but whose pages it cannot view (Reviewers Req 5.5, 5.6)', async () => {
      const before = await store(
        [edit(await kit.createPage('queue-before'))],
        [reviewer()],
      );
      const hiddenOnly = await store(
        [edit(await groupPage('queue-hidden'))],
        [reviewer()],
      );
      const after = await store(
        [edit(await kit.createPage('queue-after'))],
        [reviewer()],
      );
      asUser(reviewer());

      const pages: { items: { id: string }[]; nextCursor: string | null }[] =
        [];
      let cursor: string | null = null;
      do {
        // biome-ignore lint/performance/noAwaitInLoops: each page needs the cursor of the one before
        const res = await t.getQueue(
          cursor == null ? { limit: '1' } : { limit: '1', cursor },
        );
        expect(res.status).toBe(200);
        pages.push(res.body);
        cursor = res.body.nextCursor;
      } while (cursor != null);

      const listed = pages.flatMap((page) => page.items.map((i) => i.id));
      expect(listed.indexOf(before._id)).toBeGreaterThanOrEqual(0);
      expect(listed.indexOf(after._id)).toBeGreaterThan(
        listed.indexOf(before._id),
      );
      expect(JSON.stringify(pages)).not.toContain(hiddenOnly._id);
    });
  });

  describe('the requester, who can no longer view one of the pages', () => {
    it('learns nothing of what the reviewer did on that page: not in the proposal, nor in any notification (Reviewers Req 3.8, 6.5)', async () => {
      const shared = await kit.createPage('requester-shared');
      const created = await pageBy('requester-lost', reviewer(), {
        grant: PageGrant.GRANT_OWNER,
      });
      const proposal = await store([edit(shared), edit(created)], [reviewer()]);
      const [sharedKey, lostKey] = keysOf(proposal);

      await as(reviewer(), async () => {
        const answers = [
          await t.postReview(proposal._id, {
            kind: 'reject',
            operationKeys: [sharedKey, lostKey],
            comment: SHARED_COMMENT,
          }),
          await t.postReview(proposal._id, {
            kind: 'abstain',
            operationKeys: [lostKey],
            comment: LOST_COMMENT,
          }),
          await t.postAction(proposal._id, 'approve', {
            operationKeys: [lostKey],
          }),
          await t.postReview(proposal._id, {
            kind: 'reject',
            comment: OWN_WHOLE_COMMENT,
          }),
        ];
        expect(answers.map((res) => res.status)).toEqual([200, 200, 200, 200]);
      });
      const read = await as(users.requester, () => t.getProposal(proposal._id));

      expect(
        read.body.proposal.operations.map((op: { key: string }) => op.key),
      ).toEqual([sharedKey]);
      expect(read.body.proposal.operations[0].rejections).toEqual([
        expect.objectContaining({ comment: SHARED_COMMENT }),
      ]);
      expect(read.body.proposal.wholeRejections).toEqual([
        expect.objectContaining({ comment: OWN_WHOLE_COMMENT }),
      ]);
      const notifications = await notificationsOf(
        users.requester,
        proposal._id,
      );
      expect(notifications).toEqual([
        {
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_RESULT,
          snapshot: expect.objectContaining({
            items: [
              {
                path: shared.path,
                result: 'rejected',
                comment: SHARED_COMMENT,
              },
            ],
          }),
        },
        {
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_RESULT,
          snapshot: expect.objectContaining({
            items: [],
            wholeRejection: { comment: OWN_WHOLE_COMMENT },
          }),
        },
      ]);
      const seen = JSON.stringify([read.body, notifications]);
      for (const secret of [
        created.path,
        created._id.toString(),
        lostKey,
        LOST_COMMENT,
      ]) {
        expect(seen).not.toContain(secret);
      }
      const rows = await prisma.activities.findMany({
        where: { target: proposal._id },
      });
      expect(JSON.stringify(rows)).not.toContain(LOST_COMMENT);
    });
  });

  describe('a user who is neither the requester nor a reviewer', () => {
    it('is answered for a pending proposal exactly as for a missing one, even on pages it can view (Reviewers Req 2.7, 5.3)', async () => {
      const proposal = await store(
        [edit(await kit.createPage('stranger-pending'))],
        [reviewer()],
      );
      const missing = new Types.ObjectId().toString();

      const answers = await as(stranger(), async () => {
        const run = async (id: string) => [
          await t.getProposal(id),
          await t.postAction(id, 'approve'),
          await t.postReview(id, { kind: 'reject' }),
          await t.patchReviewers(id, { add: [userInput(stranger())] }),
        ];
        return { real: await run(proposal._id), missing: await run(missing) };
      });

      expect(answers.real.map((res) => res.status)).toEqual([
        404, 404, 404, 404,
      ]);
      expect(shapesOf(answers.real)).toEqual(shapesOf(answers.missing));
      expect(await notificationsOf(stranger(), proposal._id)).toEqual([]);
    });

    it('reads a partly applied proposal exactly as one with nothing left pending (Reviewers Req 5.3, 5.10)', async () => {
      const x = await store(
        [
          edit(await kit.createPage('stranger-applied')),
          edit(await kit.createPage('stranger-still-pending')),
        ],
        [reviewer()],
      );
      const y = await store(
        [edit(await kit.createPage('stranger-applied-twin'))],
        [reviewer()],
      );
      await as(reviewer(), async () => {
        await t.postAction(x._id, 'approve', {
          operationKeys: [keysOf(x)[0]],
        });
        await t.postAction(y._id, 'approve');
      });
      await kit.waitForPageOperationsToFinish();

      const [readX, readY] = await as(stranger(), async () => [
        await t.getProposal(x._id),
        await t.getProposal(y._id),
      ]);

      expect(readX.status).toBe(200);
      expect(shapesOf([readX])).toEqual(shapesOf([readY]));
      expect(JSON.stringify(readX.body)).not.toContain(keysOf(x)[1]);
      expect(await notificationsOf(stranger(), x._id)).toEqual([]);
    });
  });
});
