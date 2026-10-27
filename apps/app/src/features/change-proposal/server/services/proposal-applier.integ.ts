import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import {
  beginActivity,
  pendingActivityContext,
} from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { createOperationHandlers } from './operation-handlers';
import {
  createApplierTestKit,
  type HandlerOverrides,
} from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.146';
const TEST_ENDPOINT = '/_api/v3/cp-proposal-applier-integ';

describe('ProposalApplier.apply', () => {
  let crowi: Crowi;
  const {
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
    newApplier,
    setUp,
    resetPerPageNotificationsSetting,
    tearDown,
  } = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: '/cp-proposal-applier-integ',
    ip: TEST_IP,
    usernames: {
      requester: 'cpApplierRequester',
      subscriber: 'cpApplierSubscriber',
      other: 'cpApplierOther',
    },
  });

  const applyActivities = (proposalId: string) =>
    prisma.activities.findMany({
      where: {
        target: proposalId,
        action: {
          in: [
            SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
            SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
          ],
        },
      },
    });

  const waitForActivities = (proposalId: string, count: number) =>
    vi.waitFor(
      async () => {
        const rows = await applyActivities(proposalId);
        expect(rows).toHaveLength(count);
        return rows;
      },
      { timeout: 5000, interval: 50 },
    );

  const observedHandlers = (overrides: HandlerOverrides = {}) => {
    const sendPerPageNotifications = vi.fn(async () => {});
    return {
      ...buildHandlers(sendPerPageNotifications, overrides),
      sendPerPageNotifications,
    };
  };

  const request = { ip: TEST_IP, endpoint: TEST_ENDPOINT };

  beforeAll(async () => {
    crowi = await getInstance();
    await setUp();
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await resetPerPageNotificationsSetting();
  });

  afterAll(async () => {
    await tearDown();
  });

  it('applies approved operations in the planned order (moves last), records each result, settles, and reports once', async () => {
    const edited = await createPage('edited');
    const moved = await createPage('moved');
    await subscribe(edited);
    const createdPath = nextPath('created');
    const movedTo = nextPath('moved-to');
    const proposal = await storeProposal([
      {
        type: 'move',
        pageId: moved._id.toString(),
        fromPath: moved.path,
        toPath: movedTo,
      },
      editInput(edited),
      { type: 'create', path: createdPath, body: 'new page body' },
    ]);
    const [moveKey, editKey, createKey] = proposal.operations.map(
      (op) => op.key,
    );
    const applier = newApplier({
      handlers: observedHandlers().table,
    });

    const result = await applier.apply(
      proposal._id,
      { kind: 'background' },
      request,
    );

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: editKey, status: 'applied' },
        { key: createKey, status: 'applied' },
        { key: moveKey, status: 'applied' },
      ],
    });
    const after = await reload(proposal._id);
    expect(after.lifecycle).toBe('settled');
    expect(after.applyLease ?? null).toBeNull();
    expect(after.lastAppliedAt).toBeInstanceOf(Date);
    const createdPage = await mongoose
      .model('Page')
      .findOne({ path: createdPath });
    expect(new Set(after.appliedPageIds)).toEqual(
      new Set([
        edited._id.toString(),
        moved._id.toString(),
        createdPage?._id.toString(),
      ]),
    );
    for (const key of [moveKey, editKey, createKey]) {
      const op = operationOf(after, key);
      expect(op.status).toBe('applied');
      expect(op.appliedAt).toBeInstanceOf(Date);
    }
    expect(operationOf(after, editKey).resultRevisionId).toBe(
      (await markedRevisions(proposal._id, editKey))[0].id,
    );
    expect((await findPage(moved._id)).path).toBe(movedTo);

    const notifications = await aggregatedNotifications(proposal._id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].user.toString()).toBe(
      users.subscriber._id.toString(),
    );
    const [activity] = await waitForActivities(proposal._id, 1);
    expect(activity.action).toBe(SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY);
    expect(activity).toMatchObject({
      userId: users.requester._id.toString(),
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });
    expect(notifications[0].activities.map(String)).toEqual([activity.id]);
  });

  it('leaves unapproved pending operations alone and keeps the proposal open', async () => {
    const page = await createPage('unapproved');
    const proposal = await storeProposal([editInput(page)], {
      approve: false,
    });
    const applier = newApplier();

    const result = await applier.apply(proposal._id, { kind: 'background' });

    expect(result).toEqual({ type: 'done', results: [] });
    const after = await reload(proposal._id);
    expect(after.lifecycle).toBe('open');
    expect(after.operations[0].status).toBe('pending');
    expect(
      await markedRevisions(proposal._id, after.operations[0].key),
    ).toEqual([]);
    expect(await aggregatedNotifications(proposal._id)).toHaveLength(0);
    expect(await applyActivities(proposal._id)).toHaveLength(0);
  });

  it('sends per-page notifications for an operation this run wrote when both switches are on', async () => {
    await configManager.updateConfigs({
      'changeProposal:perPageNotificationsEnabled': true,
    });
    const page = await createPage('per-page');
    const proposal = await storeProposal([editInput(page)], {
      perPageNotifications: true,
    });
    const { table, sendPerPageNotifications } = observedHandlers();

    await newApplier({ handlers: table }).apply(proposal._id, {
      kind: 'background',
    });

    expect(sendPerPageNotifications).toHaveBeenCalledTimes(1);
    expect(sendPerPageNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ key: proposal.operations[0].key }),
      expect.objectContaining({ status: 'applied' }),
      expect.objectContaining({ perPageNotifications: true }),
    );
  });

  it('records a throwing handler as failed: write-error and goes on with the next operation', async () => {
    const broken = await createPage('broken');
    const fine = await createPage('fine');
    const proposal = await storeProposal([editInput(broken), editInput(fine)]);
    const [brokenKey, fineKey] = proposal.operations.map((op) => op.key);
    const real = createOperationHandlers(crowi);
    const { table } = observedHandlers({
      edit: {
        execute: (op, ctx) => {
          if (op.key === brokenKey) {
            return Promise.reject(new Error('unexpected write failure'));
          }
          return real.edit.execute(op, ctx);
        },
      },
    });

    const result = await newApplier({
      handlers: table,
    }).apply(proposal._id, { kind: 'background' });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: brokenKey, status: 'failed', reason: 'write-error' },
        { key: fineKey, status: 'applied' },
      ],
    });
    const after = await reload(proposal._id);
    expect(operationOf(after, brokenKey)).toMatchObject({
      status: 'failed',
      reason: 'write-error',
    });
    expect(operationOf(after, fineKey).status).toBe('applied');
    expect(after.appliedPageIds).toEqual([fine._id.toString()]);
    expect(after.lifecycle).toBe('settled');
  });

  it('records an edit whose base revision moved on as stale, without undoing operations applied before it', async () => {
    const first = await createPage('first');
    const changed = await createPage('changed');
    const proposal = await storeProposal([
      editInput(first),
      editInput(changed),
    ]);
    const [firstKey, changedKey] = proposal.operations.map((op) => op.key);
    await crowi.pageService.updatePage(
      changed,
      'human edit',
      null,
      users.other,
      {},
    );
    await waitForPageOperationsToFinish();

    const result = await newApplier().apply(proposal._id, {
      kind: 'background',
    });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: firstKey, status: 'applied' },
        {
          key: changedKey,
          status: 'stale',
          reason: 'base-revision-changed',
        },
      ],
    });
    const after = await reload(proposal._id);
    expect(operationOf(after, firstKey).status).toBe('applied');
    expect(operationOf(after, changedKey).status).toBe('stale');
    expect(after.lifecycle).toBe('settled');
  });

  it('applies approvals recorded while the run holds the lease before releasing it', async () => {
    const first = await createPage('during-first');
    const second = await createPage('during-second');
    const proposal = await storeProposal([editInput(first), editInput(second)]);
    const [firstKey, secondKey] = proposal.operations.map((op) => op.key);
    // Withdraw the second approval, then grant it again while the first operation is written.
    await prisma.changeproposals.updateMany({
      where: { id: proposal._id },
      data: {
        operations: {
          updateMany: {
            where: { key: secondKey },
            data: { approvedAt: { unset: true } },
          },
        },
      },
    });
    const real = createOperationHandlers(crowi);
    const { table } = observedHandlers({
      edit: {
        execute: async (op, ctx) => {
          if (op.key === firstKey) {
            await prisma.changeproposals.markApproved(
              proposal._id,
              users.requester._id.toString(),
              [secondKey],
              new Date(),
            );
          }
          return real.edit.execute(op, ctx);
        },
      },
    });

    const result = await newApplier({
      handlers: table,
    }).apply(proposal._id, { kind: 'background' });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: firstKey, status: 'applied' },
        { key: secondKey, status: 'applied' },
      ],
    });
    expect((await reload(proposal._id)).lifecycle).toBe('settled');
  });

  it('notifies only the pages applied in each run when approvals come in two steps', async () => {
    const first = await createPage('step-first');
    const second = await createPage('step-second');
    await subscribe(first);
    await subscribe(second);
    const proposal = await storeProposal(
      [editInput(first), editInput(second)],
      {
        approve: false,
      },
    );
    const [firstKey, secondKey] = proposal.operations.map((op) => op.key);
    const requesterId = users.requester._id.toString();
    const applier = newApplier();

    await prisma.changeproposals.markApproved(
      proposal._id,
      requesterId,
      [firstKey],
      new Date(),
    );
    await applier.apply(proposal._id, { kind: 'background' });
    expect((await reload(proposal._id)).lifecycle).toBe('open');

    await prisma.changeproposals.markApproved(
      proposal._id,
      requesterId,
      [secondKey],
      new Date(),
    );
    await applier.apply(proposal._id, { kind: 'background' });

    const after = await reload(proposal._id);
    expect(after.lifecycle).toBe('settled');
    const notifications = await aggregatedNotifications(proposal._id);
    expect(notifications.map(snapshotPagesOf)).toEqual([
      [first._id.toString()],
      [second._id.toString()],
    ]);
    await waitForActivities(proposal._id, 2);
  });

  it('records the apply on the route activity when triggered by a request', async () => {
    const page = await createPage('request');
    const proposal = await storeProposal([editInput(page)]);
    // What the add-activity middleware stashes for the request's operator.
    const { activityId } = beginActivity({
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
      userId: users.requester._id.toString(),
      username: users.requester.username,
      createdAt: new Date(),
    });

    await newApplier().apply(proposal._id, {
      kind: 'request',
      activityId,
    });
    // The response's finish clears the stashed context.
    pendingActivityContext.clear(activityId);

    const [activity] = await waitForActivities(proposal._id, 1);
    expect(activity).toMatchObject({
      id: activityId,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      userId: users.requester._id.toString(),
      ip: TEST_IP,
    });
  });

  it('settles a revert proposal once its operations are applied and records a revert activity', async () => {
    const page = await createPage('reverted');
    const original = await storeProposal([editInput(page)]);
    const revert = await storeProposal(
      [
        {
          ...editInput(page, 'base body'),
          revertTarget: {
            proposalId: original._id,
            operationKey: original.operations[0].key,
          },
        },
      ],
      { entry: 'revert', revertOf: original._id },
    );

    const result = await newApplier().apply(revert._id, {
      kind: 'background',
    });

    expect(result).toMatchObject({
      type: 'done',
      results: [{ status: 'applied' }],
    });
    expect((await reload(revert._id)).lifecycle).toBe('settled');
    const [activity] = await waitForActivities(revert._id, 1);
    expect(activity.action).toBe(SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT);
  });

  it('leaves the base proposal operations untouched when a follow-up proposal is applied', async () => {
    const page = await createPage('base');
    const base = await storeProposal([editInput(page)]);
    const applier = newApplier();
    await applier.apply(base._id, { kind: 'background' });
    const baseBefore = await reload(base._id);
    const followUp = await storeProposal(
      [editInput(await findPage(page._id), 'follow-up body')],
      {
        basedOn: {
          proposalId: base._id,
          relation: 'rework',
          operationKeys: [base.operations[0].key],
        },
      },
    );

    await applier.apply(followUp._id, { kind: 'background' });

    expect((await reload(followUp._id)).operations[0].status).toBe('applied');
    expect((await reload(base._id)).operations).toEqual(baseBefore.operations);
  });

  it('records requester-not-allowed when the requester no longer exists', async () => {
    const page = await createPage('ghost');
    const proposal = await storeProposal([editInput(page)], {
      requester: new mongoose.Types.ObjectId().toString(),
    });

    const result = await newApplier().apply(proposal._id, {
      kind: 'background',
    });

    expect(result).toEqual({
      type: 'done',
      results: [
        {
          key: proposal.operations[0].key,
          status: 'failed',
          reason: 'requester-not-allowed',
        },
      ],
    });
    expect((await reload(proposal._id)).lifecycle).toBe('settled');
  });
});
