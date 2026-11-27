import type { IUserHasId } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import { createOperationHandlers } from './operation-handlers';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.147';
const PREFIX = '/cp-proposal-applier-checks-integ';
const SHORT_WAIT = { timeoutMs: 300, intervalMs: 20 } as const;

describe('ProposalApplier.apply pre-write checks', () => {
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
    editingPageIds,
    newApplier,
    setUp,
    tearDown,
  } = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpApplierChecksRequester',
      subscriber: 'cpApplierChecksSubscriber',
      other: 'cpApplierChecksOther',
    },
  });
  const extraUsernames: string[] = [];
  const PageOperation = () =>
    mongoose.model<IPageOperation, PageOperationModel>('PageOperation');

  const createUser = (
    label: string,
    fields: { readonly status: number; readonly readOnly: boolean },
  ): Promise<HydratedDocument<IUserHasId>> => {
    const username = `cpApplierChecks${label}`;
    extraUsernames.push(username);
    return mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      ...fields,
    });
  };

  // A page operation another request left running on the given path.
  const occupyWithPageOperation = (path: string) =>
    PageOperation().create({
      actionType: PageActionType.Rename,
      actionStage: PageActionStage.Main,
      fromPath: path,
      toPath: `${path}-elsewhere`,
      page: { _id: new mongoose.Types.ObjectId(), path },
      user: { _id: users.other._id },
    });

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
    await configManager.updateConfigs({ 'app:changeProposalEnabled': true });
    await configManager.updateConfigs(
      { 'changeProposal:isEditEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await mongoose
      .model('User')
      .deleteMany({ username: { $in: extraUsernames } });
    await tearDown();
  });

  it('fails every operation with feature-disabled and writes nothing while the feature is off', async () => {
    await configManager.updateConfigs({ 'app:changeProposalEnabled': false });
    const page = await createPage('feature-off');
    const createdPath = nextPath('feature-off-created');
    const proposal = await storeProposal([
      editInput(page),
      { type: 'create', path: createdPath, body: 'never written' },
    ]);
    const [editKey, createKey] = proposal.operations.map((op) => op.key);

    const result = await newApplier().apply(proposal._id, {
      kind: 'background',
    });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: editKey, status: 'failed', reason: 'feature-disabled' },
        { key: createKey, status: 'failed', reason: 'feature-disabled' },
      ],
    });
    expect(await markedRevisions(proposal._id, editKey)).toHaveLength(0);
    expect(
      await mongoose.model('Page').exists({ path: createdPath }),
    ).toBeNull();
    expect((await reload(proposal._id)).lifecycle).toBe('settled');
  });

  it('fails only the operation whose type is disabled and applies the others', async () => {
    await configManager.updateConfigs({
      'changeProposal:isEditEnabled': false,
    });
    const page = await createPage('type-off');
    const createdPath = nextPath('type-off-created');
    const proposal = await storeProposal([
      editInput(page),
      { type: 'create', path: createdPath, body: 'created body' },
    ]);
    const [editKey, createKey] = proposal.operations.map((op) => op.key);

    const result = await newApplier().apply(proposal._id, {
      kind: 'background',
    });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: editKey, status: 'failed', reason: 'operation-type-disabled' },
        { key: createKey, status: 'applied' },
      ],
    });
    expect(await markedRevisions(proposal._id, editKey)).toHaveLength(0);
  });

  it.each([
    {
      label: 'ReadOnly',
      fields: { status: UserStatus.STATUS_ACTIVE, readOnly: true },
    },
    {
      label: 'Suspended',
      fields: { status: UserStatus.STATUS_SUSPENDED, readOnly: false },
    },
  ])('fails with requester-not-allowed and writes nothing when the requester is $label', async ({
    label,
    fields,
  }) => {
    const requester = await createUser(label, fields);
    const page = await createPage(`requester-${label}`);
    const proposal = await storeProposal([editInput(page)], {
      requester: requester._id.toString(),
    });
    const [key] = proposal.operations.map((op) => op.key);

    const result = await newApplier().apply(proposal._id, {
      kind: 'background',
    });

    expect(result).toEqual({
      type: 'done',
      results: [{ key, status: 'failed', reason: 'requester-not-allowed' }],
    });
    expect(await markedRevisions(proposal._id, key)).toHaveLength(0);
  });

  it('puts an operation on a page being edited back to waiting without its approval, applies the rest, and applies it once approved again', async () => {
    const edited = await createPage('being-edited');
    const createdPath = nextPath('beside-edited');
    const proposal = await storeProposal([
      editInput(edited),
      { type: 'create', path: createdPath, body: 'created body' },
    ]);
    const [editKey, createKey] = proposal.operations.map((op) => op.key);
    editingPageIds.add(edited._id.toString());
    const applier = newApplier();

    const result = await applier.apply(proposal._id, { kind: 'background' });

    expect(result).toEqual({
      type: 'done',
      results: [
        { key: editKey, status: 'pending', reason: 'page-being-edited' },
        { key: createKey, status: 'applied' },
      ],
    });
    const waiting = await reload(proposal._id);
    expect(operationOf(waiting, editKey)).toMatchObject({
      status: 'pending',
      reason: 'page-being-edited',
    });
    expect(operationOf(waiting, editKey).approvedAt).toBeUndefined();
    expect(waiting.lifecycle).toBe('open');
    expect(await markedRevisions(proposal._id, editKey)).toHaveLength(0);

    editingPageIds.clear();
    await prisma.changeproposals.markApproved(
      proposal._id,
      users.requester._id.toString(),
      [editKey],
      new Date(),
    );
    await applier.apply(proposal._id, { kind: 'background' });

    const applied = await reload(proposal._id);
    expect(operationOf(applied, editKey).status).toBe('applied');
    expect(applied.lifecycle).toBe('settled');
    expect(await markedRevisions(proposal._id, editKey)).toHaveLength(1);
  });

  it('puts an operation back to waiting without its approval when an overlapping page operation outlasts the wait', async () => {
    const page = await createPage('overlapped');
    await occupyWithPageOperation(page.path);
    const proposal = await storeProposal([editInput(page)]);
    const [key] = proposal.operations.map((op) => op.key);

    const result = await newApplier({ pageOperationWait: SHORT_WAIT }).apply(
      proposal._id,
      { kind: 'background' },
    );

    expect(result).toEqual({
      type: 'done',
      results: [
        { key, status: 'pending', reason: 'page-operation-in-progress' },
      ],
    });
    const waiting = await reload(proposal._id);
    expect(operationOf(waiting, key).approvedAt).toBeUndefined();
    expect(waiting.lifecycle).toBe('open');
    expect(await markedRevisions(proposal._id, key)).toHaveLength(0);
  });

  it('puts a create and a move back to waiting while a page operation overlaps the path they write to', async () => {
    const createdPath = nextPath('overlapped-create');
    const moved = await createPage('overlapped-move');
    const movedTo = nextPath('overlapped-move-to');
    await occupyWithPageOperation(createdPath);
    await occupyWithPageOperation(movedTo);
    const proposal = await storeProposal([
      { type: 'create', path: createdPath, body: 'never written' },
      {
        type: 'move',
        pageId: moved._id.toString(),
        fromPath: moved.path,
        toPath: movedTo,
      },
    ]);
    const [createKey, moveKey] = proposal.operations.map((op) => op.key);

    const result = await newApplier({ pageOperationWait: SHORT_WAIT }).apply(
      proposal._id,
      { kind: 'background' },
    );

    expect(result).toEqual({
      type: 'done',
      results: [
        {
          key: createKey,
          status: 'pending',
          reason: 'page-operation-in-progress',
        },
        {
          key: moveKey,
          status: 'pending',
          reason: 'page-operation-in-progress',
        },
      ],
    });
    expect(
      await mongoose.model('Page').exists({ path: createdPath }),
    ).toBeNull();
    expect((await findPage(moved._id)).path).toBe(moved.path);
  });

  it('puts a move of a page without children back to waiting while a page operation writes below that page', async () => {
    const moved = await createPage('overlapped-below');
    await PageOperation().create({
      actionType: PageActionType.Rename,
      actionStage: PageActionStage.Main,
      fromPath: nextPath('elsewhere'),
      toPath: `${moved.path}/incoming`,
      page: { _id: new mongoose.Types.ObjectId(), path: nextPath('elsewhere') },
      user: { _id: users.other._id },
    });
    const movedTo = nextPath('overlapped-below-to');
    const proposal = await storeProposal([
      {
        type: 'move',
        pageId: moved._id.toString(),
        fromPath: moved.path,
        toPath: movedTo,
      },
    ]);
    const [key] = proposal.operations.map((op) => op.key);

    const result = await newApplier({ pageOperationWait: SHORT_WAIT }).apply(
      proposal._id,
      { kind: 'background' },
    );

    expect(result).toEqual({
      type: 'done',
      results: [
        { key, status: 'pending', reason: 'page-operation-in-progress' },
      ],
    });
    expect((await findPage(moved._id)).path).toBe(moved.path);
  });

  it('waits for an overlapping page operation that ends within the wait and then applies', async () => {
    const page = await createPage('briefly-overlapped');
    const pageOperation = await occupyWithPageOperation(page.path);
    const proposal = await storeProposal([editInput(page)]);
    const [key] = proposal.operations.map((op) => op.key);
    const finishing = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        PageOperation()
          .deleteOne({ _id: pageOperation._id })
          .then(() => resolve(), reject);
      }, 100);
    });

    const result = await newApplier({
      pageOperationWait: { timeoutMs: 3000, intervalMs: 20 },
    }).apply(proposal._id, { kind: 'background' });
    await finishing;

    expect(result).toEqual({
      type: 'done',
      results: [{ key, status: 'applied' }],
    });
    expect(await markedRevisions(proposal._id, key)).toHaveLength(1);
  });

  it('does not wait for a page operation on an unrelated path', async () => {
    const page = await createPage('not-overlapped');
    await occupyWithPageOperation(nextPath('unrelated'));
    const proposal = await storeProposal([editInput(page)]);
    const [key] = proposal.operations.map((op) => op.key);

    const result = await newApplier({ pageOperationWait: SHORT_WAIT }).apply(
      proposal._id,
      { kind: 'background' },
    );

    expect(result).toEqual({
      type: 'done',
      results: [{ key, status: 'applied' }],
    });
  });

  describe('an operation an interrupted run already wrote', () => {
    // The interrupted run wrote the page and died before recording the result.
    const writeAsInterruptedRun = async (
      proposal: ChangeProposalDocument,
      requester: HydratedDocument<IUserHasId>,
    ): Promise<string> => {
      const [op] = proposal.operations;
      if (op.type !== 'edit') {
        throw new Error('expected an edit operation');
      }
      const outcome = await createOperationHandlers(crowi).edit.execute(op, {
        proposalId: proposal._id,
        operationKey: op.key,
        requester,
        activityParameters: {},
        perPageNotifications: false,
      });
      expect(outcome.status).toBe('applied');
      return op.key;
    };

    it('is recorded applied even though the page is being edited now', async () => {
      const page = await createPage('written-then-edited');
      const proposal = await storeProposal([editInput(page)]);
      const key = await writeAsInterruptedRun(proposal, users.requester);
      editingPageIds.add(page._id.toString());

      const result = await newApplier().apply(proposal._id, {
        kind: 'background',
      });

      expect(result).toEqual({
        type: 'done',
        results: [{ key, status: 'applied' }],
      });
      expect(await markedRevisions(proposal._id, key)).toHaveLength(1);
      expect((await reload(proposal._id)).lifecycle).toBe('settled');
    });

    it('is recorded applied even though the feature is disabled now', async () => {
      const page = await createPage('written-then-disabled');
      const proposal = await storeProposal([editInput(page)]);
      const key = await writeAsInterruptedRun(proposal, users.requester);
      await configManager.updateConfigs({ 'app:changeProposalEnabled': false });

      const result = await newApplier().apply(proposal._id, {
        kind: 'background',
      });

      expect(result).toEqual({
        type: 'done',
        results: [{ key, status: 'applied' }],
      });
      expect(await markedRevisions(proposal._id, key)).toHaveLength(1);
    });

    it('is recorded applied for a revert proposal, marking the original operation reverted, even though the requester is suspended now', async () => {
      const page = await createPage('revert-written-then-suspended');
      const original = await storeProposal([editInput(page, 'proposed body')]);
      const [originalKey] = original.operations.map((op) => op.key);
      await newApplier().apply(original._id, { kind: 'background' });
      const reverter = await createUser('Reverter', {
        status: UserStatus.STATUS_ACTIVE,
        readOnly: false,
      });
      const revert = await storeProposal(
        [
          {
            ...editInput(await findPage(page._id), 'base body'),
            revertTarget: {
              proposalId: original._id,
              operationKey: originalKey,
            },
          },
        ],
        {
          entry: 'revert',
          revertOf: original._id,
          requester: reverter._id.toString(),
        },
      );
      const key = await writeAsInterruptedRun(revert, reverter);
      await mongoose
        .model('User')
        .updateOne(
          { _id: reverter._id },
          { status: UserStatus.STATUS_SUSPENDED },
        );

      const result = await newApplier().apply(revert._id, {
        kind: 'background',
      });

      expect(result).toEqual({
        type: 'done',
        results: [{ key, status: 'applied' }],
      });
      expect(await markedRevisions(revert._id, key)).toHaveLength(1);
      expect(
        operationOf(await reload(original._id), originalKey),
      ).toMatchObject({
        status: 'reverted',
        revertedByProposalId: revert._id,
      });
    });
  });
});
