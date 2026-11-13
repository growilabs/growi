import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument, OperationRecord } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type WriteOriginalMark,
  writeOriginalMarkToDb,
} from './mark-original-operation';
import { createOperationHandlers } from './operation-handlers';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.148';
const PREFIX = '/cp-proposal-applier-revert-integ';

describe('ProposalApplier.apply writing revert results onto the original operation', () => {
  let crowi: Crowi;
  const {
    users,
    nextPath,
    waitForPageOperationsToFinish,
    createPage,
    findPage,
    editInput,
    storeProposal,
    reload,
    operationOf,
    markedRevisions,
    buildHandlers,
    editingPageIds,
    newApplier,
    setUp,
    tearDown,
  } = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpApplierRevertRequester',
      subscriber: 'cpApplierRevertSubscriber',
      other: 'cpApplierRevertOther',
    },
  });
  const PageOperation = () =>
    mongoose.model<IPageOperation, PageOperationModel>('PageOperation');

  type AppliedOriginal = {
    readonly original: ChangeProposalDocument;
    readonly originalKey: string;
    readonly page: HydratedDocument<PageDocument>;
  };

  const applyOriginal = async (
    operation: CreateOperationInput,
    page: HydratedDocument<PageDocument>,
  ): Promise<AppliedOriginal> => {
    const original = await storeProposal([operation]);
    await newApplier().apply(original._id, { kind: 'background' });
    await waitForPageOperationsToFinish();
    const [originalKey] = original.operations.map((op) => op.key);
    expect(operationOf(await reload(original._id), originalKey).status).toBe(
      'applied',
    );
    return { original, originalKey, page: await findPage(page._id) };
  };

  const applyOriginalEdit = async (label: string): Promise<AppliedOriginal> => {
    const page = await createPage(label);
    return applyOriginal(editInput(page, 'proposed body'), page);
  };

  const revertOf = (
    { original, originalKey }: AppliedOriginal,
    operation: CreateOperationInput,
  ): Promise<ChangeProposalDocument> =>
    storeProposal(
      [
        {
          ...operation,
          revertTarget: { proposalId: original._id, operationKey: originalKey },
        },
      ],
      { entry: 'revert', revertOf: original._id },
    );

  const originalOperation = async ({
    original,
    originalKey,
  }: AppliedOriginal): Promise<OperationRecord> =>
    operationOf(await reload(original._id), originalKey);

  beforeAll(async () => {
    crowi = await getInstance();
    await setUp();
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    editingPageIds.clear();
    await PageOperation().deleteMany({ fromPath: new RegExp(`^${PREFIX}/`) });
    await waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await tearDown();
  });

  it('marks the original operation reverted with the revert proposal id when the revert is applied', async () => {
    const applied = await applyOriginalEdit('reverted');
    const revert = await revertOf(
      applied,
      editInput(applied.page, 'base body'),
    );

    await newApplier().apply(revert._id, { kind: 'background' });

    const original = await originalOperation(applied);
    expect(original).toMatchObject({
      status: 'reverted',
      revertedByProposalId: revert._id,
    });
    expect(original.revertedAt).toBeInstanceOf(Date);
    const [revertKey] = revert.operations.map((op) => op.key);
    expect(operationOf(await reload(revert._id), revertKey)).toMatchObject({
      status: 'applied',
      appliedPagePath: applied.page.path,
    });
  });

  it('marks the original operation reverted when the revert write was already done by an interrupted run', async () => {
    const applied = await applyOriginalEdit('reverted-earlier');
    const revert = await revertOf(
      applied,
      editInput(applied.page, 'base body'),
    );
    const [revertKey] = revert.operations.map((op) => op.key);
    const revertOperation = operationOf(revert, revertKey);
    if (revertOperation.type !== 'edit') {
      throw new Error('expected an edit operation');
    }
    await createOperationHandlers(crowi).edit.execute(revertOperation, {
      proposalId: revert._id,
      operationKey: revertKey,
      requester: users.requester,
      activityParameters: {},
      perPageNotifications: false,
    });

    await newApplier().apply(revert._id, { kind: 'background' });

    expect(await markedRevisions(revert._id, revertKey)).toHaveLength(1);
    expect(await originalOperation(applied)).toMatchObject({
      status: 'reverted',
      revertedByProposalId: revert._id,
    });
    expect(operationOf(await reload(revert._id), revertKey)).toMatchObject({
      status: 'applied',
      appliedPagePath: applied.page.path,
    });
  });

  it('reverts a move between Japanese paths and leaves no redirect at either path', async () => {
    const page = await createPage('日本語/a.b(1)[仮]{2}|x　y');
    const originalPath = page.path;
    const movedTo = nextPath('移動先/ページ　全角空白（かっこ）');
    const applied = await applyOriginal(
      {
        type: 'move',
        pageId: page._id.toString(),
        fromPath: originalPath,
        toPath: movedTo,
      },
      page,
    );
    const revert = await revertOf(applied, {
      type: 'move',
      pageId: page._id.toString(),
      fromPath: movedTo,
      toPath: originalPath,
      removeRedirectsFrom: originalPath,
    });

    await newApplier().apply(revert._id, { kind: 'background' });
    await waitForPageOperationsToFinish();

    expect((await findPage(page._id)).path).toBe(originalPath);
    expect(
      await prisma.pageredirects.count({
        where: { fromPath: { in: [originalPath, movedTo] } },
      }),
    ).toBe(0);
    expect(await originalOperation(applied)).toMatchObject({
      status: 'reverted',
      revertedByProposalId: revert._id,
    });
  });

  it('refuses the revert with edited-after-apply when the revert operation turns stale', async () => {
    const page = await createPage('edited-after');
    const staleBase = editInput(page, 'base body');
    const applied = await applyOriginal(editInput(page, 'proposed body'), page);
    const revert = await revertOf(applied, staleBase);

    const result = await newApplier().apply(revert._id, {
      kind: 'background',
    });

    expect(result).toMatchObject({
      type: 'done',
      results: [{ status: 'stale', reason: 'base-revision-changed' }],
    });
    expect(await originalOperation(applied)).toMatchObject({
      status: 'revert-refused',
      reason: 'edited-after-apply',
    });
  });

  it('refuses the revert with original-path-occupied when the move cannot return to its original path', async () => {
    const page = await createPage('moved-away');
    const originalPath = page.path;
    const movedTo = nextPath('moved-to');
    const applied = await applyOriginal(
      {
        type: 'move',
        pageId: page._id.toString(),
        fromPath: originalPath,
        toPath: movedTo,
      },
      page,
    );
    await crowi.pageService.create(originalPath, 'occupier', users.other, {});
    await waitForPageOperationsToFinish();
    const revert = await revertOf(applied, {
      type: 'move',
      pageId: page._id.toString(),
      fromPath: movedTo,
      toPath: originalPath,
      removeRedirectsFrom: originalPath,
    });

    const result = await newApplier().apply(revert._id, {
      kind: 'background',
    });

    expect(result).toMatchObject({
      type: 'done',
      results: [{ status: 'failed', reason: 'path-occupied' }],
    });
    expect((await findPage(page._id)).path).toBe(movedTo);
    expect(await originalOperation(applied)).toMatchObject({
      status: 'revert-refused',
      reason: 'original-path-occupied',
    });
  });

  it('keeps the refusal reason the revert operation failed with when it is already a refusal reason', async () => {
    const page = await createPage('moved-again');
    const originalPath = page.path;
    const movedTo = nextPath('moved-again-to');
    const applied = await applyOriginal(
      {
        type: 'move',
        pageId: page._id.toString(),
        fromPath: originalPath,
        toPath: movedTo,
      },
      page,
    );
    const revert = await revertOf(applied, {
      type: 'move',
      pageId: page._id.toString(),
      fromPath: nextPath('not-where-the-page-is'),
      toPath: originalPath,
      removeRedirectsFrom: originalPath,
    });

    const result = await newApplier().apply(revert._id, {
      kind: 'background',
    });

    expect(result).toMatchObject({
      type: 'done',
      results: [{ status: 'failed', reason: 'moved-after-apply' }],
    });
    expect(await originalOperation(applied)).toMatchObject({
      status: 'revert-refused',
      reason: 'moved-after-apply',
    });
  });

  it('leaves the original operation untouched when the run loses its lease before recording the revert', async () => {
    const applied = await applyOriginalEdit('lease-lost');
    const before = await originalOperation(applied);
    const revert = await revertOf(
      applied,
      editInput(applied.page, 'base body'),
    );
    const real = createOperationHandlers(crowi);
    const { table } = buildHandlers(
      vi.fn(async () => {}),
      {
        edit: {
          execute: async (op, ctx) => {
            // The lease expires mid-write and another run claims it.
            await prisma.changeproposals.claimApplyLease(
              revert._id,
              'successor',
              new Date(Date.now() + 60 * 60 * 1000),
            );
            return real.edit.execute(op, ctx);
          },
        },
      },
    );

    const result = await newApplier({ handlers: table }).apply(revert._id, {
      kind: 'background',
    });

    expect(result).toEqual({ type: 'done', results: [] });
    expect(await originalOperation(applied)).toEqual(before);
  });

  it('refuses the revert with apply-failed when the revert write fails for another reason', async () => {
    const applied = await applyOriginalEdit('write-error');
    const revert = await revertOf(
      applied,
      editInput(applied.page, 'base body'),
    );
    const { table } = buildHandlers(
      vi.fn(async () => {}),
      {
        edit: {
          execute: () => Promise.reject(new Error('boom')),
        },
      },
    );

    await newApplier({ handlers: table }).apply(revert._id, {
      kind: 'background',
    });

    expect(await originalOperation(applied)).toMatchObject({
      status: 'revert-refused',
      reason: 'apply-failed',
    });
  });

  it('skips the revert operation on a page being edited and leaves the original operation applied', async () => {
    const applied = await applyOriginalEdit('being-edited');
    const before = await originalOperation(applied);
    const revert = await revertOf(
      applied,
      editInput(applied.page, 'base body'),
    );
    const [revertKey] = revert.operations.map((op) => op.key);
    editingPageIds.add(applied.page._id.toString());

    const result = await newApplier().apply(revert._id, {
      kind: 'background',
    });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: revertKey, status: 'skipped', reason: 'page-being-edited' },
      ],
    });
    expect(await markedRevisions(revert._id, revertKey)).toHaveLength(0);
    expect(await originalOperation(applied)).toEqual(before);
    expect((await reload(revert._id)).lifecycle).toBe('settled');
  });

  it('fails the revert operation and refuses the revert with page-operation-in-progress when an overlapping page operation outlasts the wait', async () => {
    const applied = await applyOriginalEdit('overlapped');
    const revert = await revertOf(
      applied,
      editInput(applied.page, 'base body'),
    );
    const [revertKey] = revert.operations.map((op) => op.key);
    await PageOperation().create({
      actionType: PageActionType.Rename,
      actionStage: PageActionStage.Main,
      fromPath: applied.page.path,
      toPath: `${applied.page.path}-elsewhere`,
      page: { _id: new mongoose.Types.ObjectId(), path: applied.page.path },
      user: { _id: users.other._id },
    });

    const result = await newApplier({
      pageOperationWait: { timeoutMs: 300, intervalMs: 20 },
    }).apply(revert._id, { kind: 'background' });

    expect(result).toEqual({
      type: 'done',
      results: [
        {
          key: revertKey,
          status: 'failed',
          reason: 'page-operation-in-progress',
        },
      ],
    });
    expect(await markedRevisions(revert._id, revertKey)).toHaveLength(0);
    expect(await originalOperation(applied)).toMatchObject({
      status: 'revert-refused',
      reason: 'page-operation-in-progress',
    });
  });

  describe('when writing onto the original operation throws', () => {
    const noWait = (): Promise<void> => Promise.resolve();

    // Throws on the first `failures` calls, then writes for real.
    const failMarkTimes = (failures: number) => {
      let left = failures;
      return vi.fn<WriteOriginalMark>((...args) => {
        if (left > 0) {
          left -= 1;
          return Promise.reject(new Error('transient'));
        }
        return writeOriginalMarkToDb(...args);
      });
    };

    it('writes the revert result onto the original when the first two attempts throw', async () => {
      const applied = await applyOriginalEdit('mark-retried');
      const revert = await revertOf(
        applied,
        editInput(applied.page, 'base body'),
      );
      const markSpy = failMarkTimes(2);

      await newApplier({
        markRetryWait: noWait,
        writeOriginalMark: markSpy,
      }).apply(revert._id, {
        kind: 'background',
      });

      expect(markSpy).toHaveBeenCalledTimes(3);
      expect(await originalOperation(applied)).toMatchObject({
        status: 'reverted',
        revertedByProposalId: revert._id,
      });
    });

    it('gives up after two retries, keeps the revert outcome and goes on with the next operation', async () => {
      const first = await applyOriginalEdit('mark-fails-first');
      const second = await applyOriginalEdit('mark-fails-second');
      const revert = await storeProposal(
        [first, second].map((applied) => ({
          ...editInput(applied.page, 'base body'),
          revertTarget: {
            proposalId: applied.original._id,
            operationKey: applied.originalKey,
          },
        })),
        { entry: 'revert', revertOf: first.original._id },
      );
      const markSpy = failMarkTimes(3);

      const result = await newApplier({
        markRetryWait: noWait,
        writeOriginalMark: markSpy,
      }).apply(revert._id, { kind: 'background' });

      expect(result).toEqual({
        type: 'done',
        results: revert.operations.map((op) => ({
          key: op.key,
          status: 'applied',
        })),
      });
      expect(markSpy).toHaveBeenCalledTimes(4);
      expect((await originalOperation(first)).status).toBe('applied');
      expect(await originalOperation(second)).toMatchObject({
        status: 'reverted',
        revertedByProposalId: revert._id,
      });
    });

    it('does not retry when the original operation is no longer revertible', async () => {
      const applied = await applyOriginalEdit('mark-not-revertible');
      const revert = await revertOf(
        applied,
        editInput(applied.page, 'base body'),
      );
      const markSpy = vi.fn<WriteOriginalMark>().mockResolvedValue(false);

      await newApplier({
        markRetryWait: noWait,
        writeOriginalMark: markSpy,
      }).apply(revert._id, {
        kind: 'background',
      });

      expect(markSpy).toHaveBeenCalledTimes(1);
    });
  });
});
