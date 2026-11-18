import { PageGrant } from '@growi/core';
import { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import { createReviewerRoutesTestKit } from './reviewer-routes.test-kit';

describe('reviewer routes leave the existing behaviour alone', () => {
  const t = createReviewerRoutesTestKit({
    prefix: '/cp-reviewer-existing-routes-integ',
    ip: '10.0.0.197',
    usernameBase: 'cpReviewerExisting',
  });
  const { kit, users, fixtures, asUser, idOf, userInput } = t;
  let crowi: Crowi;

  const bodyOf = async (pageId: Types.ObjectId) => {
    const page = await kit.findPage(pageId);
    return (
      await prisma.revisions.findUnique({
        where: { id: page.revision?.toString() },
      })
    )?.body;
  };

  beforeAll(async () => {
    crowi = await getInstance();
  });

  it('answers a reviewer who skips, discards or switches the per-page notifications as for a missing proposal, while the requester still switches them (Reviewers Req 3.10, 8.1, 8.3)', async () => {
    const proposal = await t.reviewedProposal();
    const [key] = proposal.operations.map((op) => op.key);
    const missing = new Types.ObjectId().toString();
    const run = (id: string) => [
      () => t.postAction(id, 'skip', { operationKeys: [key] }),
      () => t.postAction(id, 'discard'),
      () => t.putPerPageNotifications(id, true),
    ];

    asUser(users.subscriber);
    const answers: { status: number; body: unknown }[][] = [[], []];
    for (const [i, id] of [proposal._id, missing].entries()) {
      for (const send of run(id)) {
        // biome-ignore lint/performance/noAwaitInLoops: one request at a time against the same proposal
        answers[i].push(await send());
      }
    }
    asUser(users.requester);
    const byRequester = await t.putPerPageNotifications(proposal._id, true);

    expect(answers[0].map((res) => res.status)).toEqual([404, 404, 404]);
    expect(answers[0].map((res) => res.body)).toEqual(
      answers[1].map((res) => res.body),
    );
    expect(byRequester.status).toBe(200);
    const reloaded = await kit.reload(proposal._id);
    expect([
      reloaded.lifecycle,
      reloaded.operations.map((op) => op.status),
      reloaded.perPageNotifications,
    ]).toEqual(['open', ['pending'], true]);
  });

  it('refuses, while reviewers are switched off, an addition naming someone new next to an existing reviewer, and stores neither (Reviewers Req 1.1, 4.6)', async () => {
    const proposal = await t.reviewedProposal();
    await t.setReviewersEnabled(false);
    asUser(users.requester);

    const res = await t.patchReviewers(proposal._id, {
      add: [userInput(users.subscriber), userInput(fixtures.addedUser)],
    });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('reviewers_disabled');
    expect(await t.activeReviewerIdsOf(proposal._id)).toEqual([
      idOf(users.subscriber),
    ]);
    await t.expectOneUnsettledAttempt(t.endpointOf(proposal._id, 'reviewers'));
  });

  it('does not let the requester approve, even by its key, an operation on a page it can no longer view (Reviewers Req 2.1)', async () => {
    const shared = await kit.createPage('requester-shared');
    const created = await crowi.pageService.create(
      kit.nextPath('requester-lost'),
      'base body',
      users.subscriber,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    const lost = await kit.findPage(created._id);
    const proposal = await t.reviewedProposal([shared, lost]);
    const [sharedKey, lostKey] = proposal.operations.map((op) => op.key);
    asUser(users.requester);

    const res = await t.postAction(proposal._id, 'approve', {
      operationKeys: [lostKey, sharedKey],
    });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({
      type: 'done',
      results: [{ key: sharedKey, status: 'applied' }],
    });
    const lostOp = kit.operationOf(await kit.reload(proposal._id), lostKey);
    expect([lostOp.status, lostOp.approvedAt ?? null]).toEqual([
      'pending',
      null,
    ]);
    expect(await bodyOf(lost._id)).toBe('base body');
  });
});
