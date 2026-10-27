import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  RevertRefusalReason,
  RevertResult,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.155';
const PREFIX = '/cp-service-revert-refusals-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.revert judging each operation against the current page', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceRevertRefusalsRequester',
      subscriber: 'cpServiceRevertRefusalsSubscriber',
      other: 'cpServiceRevertRefusalsOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const applyOriginal = async (
    operations: readonly CreateOperationInput[],
    requester = users.requester,
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations, {
      requester: requester._id.toString(),
    });
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const revertAll = async (
    proposalId: string,
  ): Promise<ServiceResult<RevertResult>> => {
    const result = await service.revert(
      proposalId,
      users.requester,
      'all-visible',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    return result;
  };

  // Reverts the single operation of a proposal and returns the revert proposal.
  const revertSingle = async (
    proposal: ChangeProposalDocument,
  ): Promise<ChangeProposalDocument> => {
    const result = await revertAll(proposal._id);
    expect(result).toMatchObject({
      ok: true,
      value: {
        operations: [{ key: proposal.operations[0].key, outcome: 'reverted' }],
      },
    });
    if (!result.ok || result.value.revertProposalId == null) {
      throw new Error('no revert proposal was created');
    }
    return kit.reload(result.value.revertProposalId);
  };

  const expectRefused = async (
    proposal: ChangeProposalDocument,
    reason: RevertRefusalReason,
  ): Promise<void> => {
    const [key] = proposal.operations.map((op) => op.key);
    await expect(revertAll(proposal._id)).resolves.toEqual({
      ok: true,
      value: { operations: [{ key, outcome: 'revert-refused', reason }] },
    });
    expect(kit.operationOf(await kit.reload(proposal._id), key)).toMatchObject({
      status: 'revert-refused',
      reason,
    });
    expect(
      await prisma.changeproposals.count({ where: { revertOf: proposal._id } }),
    ).toBe(0);
  };

  const createdPageIdOf = (proposal: ChangeProposalDocument): string => {
    const pageId = proposal.operations[0].resultPageId;
    if (pageId == null) throw new Error('create was not applied');
    return pageId;
  };

  const createPageAt = async (path: string, body = 'human page') => {
    const page = await crowi.pageService.create(path, body, users.other, {});
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const latestBodyOf = async (pageId: string): Promise<string | undefined> => {
    const page = await kit.findPage(pageId);
    const revision = await prisma.revisions.findUnique({
      where: { id: page.revision?.toString() },
    });
    return revision?.body;
  };

  const moveInput = (
    page: Awaited<ReturnType<typeof kit.findPage>>,
    toPath: string,
  ): CreateOperationInput => ({
    type: 'move',
    pageId: page._id.toString(),
    fromPath: page.path,
    toPath,
  });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
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
    await prisma.pageredirects.deleteRedirectsFromPathTree(PREFIX);
    await prisma.changeproposals.deleteMany({
      where: {
        requester: {
          in: [users.requester, users.other].map((u) => u._id.toString()),
        },
      },
    });
    await kit.tearDown();
  });

  describe('an edit', () => {
    it('is refused with edited-after-apply once someone saved the page after it', async () => {
      const page = await kit.createPage('edited');
      const original = await applyOriginal([kit.editInput(page, '提案の本文')]);
      await applyOriginal(
        [kit.editInput(await kit.findPage(page._id), '人が直した本文')],
        users.other,
      );

      await expectRefused(original, 'edited-after-apply');
      expect(await latestBodyOf(page._id.toString())).toBe('人が直した本文');
    });
  });

  describe('a create', () => {
    it('is refused with has-children when a page was created under it', async () => {
      const original = await applyOriginal([
        { type: 'create', path: kit.nextPath('parent'), body: 'body' },
      ]);
      const created = await kit.findPage(createdPageIdOf(original));
      await createPageAt(`${created.path}/child`);

      await expectRefused(original, 'has-children');
    });

    it('is refused with has-children when only an empty page holds a deeper page under it', async () => {
      const original = await applyOriginal([
        { type: 'create', path: kit.nextPath('grand-parent'), body: 'body' },
      ]);
      const created = await kit.findPage(createdPageIdOf(original));
      await createPageAt(`${created.path}/empty/grandchild`);
      expect(
        await Page().exists({ path: `${created.path}/empty`, isEmpty: true }),
      ).not.toBeNull();

      await expectRefused(original, 'has-children');
      expect((await kit.findPage(created._id)).path).toBe(created.path);
    });

    it('is refused with edited-after-apply once the created page was edited', async () => {
      const original = await applyOriginal([
        { type: 'create', path: kit.nextPath('created-edited'), body: 'body' },
      ]);
      const created = await kit.findPage(createdPageIdOf(original));
      await applyOriginal([kit.editInput(created, 'edited')], users.other);

      await expectRefused(original, 'edited-after-apply');
    });
  });

  describe('a move', () => {
    it('is refused with moved-after-apply once the page was moved again', async () => {
      const page = await kit.createPage('moved');
      const movedTo = kit.nextPath('moved-to');
      const original = await applyOriginal([moveInput(page, movedTo)]);
      await applyOriginal(
        [moveInput(await kit.findPage(page._id), kit.nextPath('moved-again'))],
        users.other,
      );

      await expectRefused(original, 'moved-after-apply');
    });

    it('is refused with original-path-occupied when a page now sits at the original path', async () => {
      const page = await kit.createPage('occupied');
      const originalPath = page.path;
      const original = await applyOriginal([
        moveInput(page, kit.nextPath('occupied-to')),
      ]);
      await createPageAt(originalPath);

      await expectRefused(original, 'original-path-occupied');
    });

    it('moves back when only an empty page holds the original path', async () => {
      const page = await kit.createPage('placeholder');
      const originalPath = page.path;
      const original = await applyOriginal([
        moveInput(page, kit.nextPath('placeholder-to')),
      ]);
      await createPageAt(`${originalPath}/child`);
      expect(
        await Page().exists({ path: originalPath, isEmpty: true }),
      ).not.toBeNull();

      await revertSingle(original);

      expect((await kit.findPage(page._id)).path).toBe(originalPath);
    });
  });

  describe('a revert proposal', () => {
    it('restores a page its trash removed, and trashes it again when that restore is reverted', async () => {
      const path = kit.nextPath('日本語/新しい　ページ（仮）');
      const original = await applyOriginal([
        { type: 'create', path, body: '作った本文' },
      ]);
      const pageId = createdPageIdOf(original);

      const trashing = await revertSingle(original);
      expect(trashing.operations.map((op) => op.type)).toEqual(['trash']);
      expect((await kit.findPage(pageId)).path).toBe(`/trash${path}`);

      const restoring = await revertSingle(trashing);
      expect(restoring).toMatchObject({
        entry: 'revert',
        revertOf: trashing._id,
        lifecycle: 'settled',
      });
      expect(restoring.operations.map((op) => op.type)).toEqual(['restore']);
      expect((await kit.findPage(pageId)).path).toBe(path);
      expect(
        await prisma.pageredirects.count({ where: { fromPath: path } }),
      ).toBe(0);
      expect(
        kit.operationOf(
          await kit.reload(trashing._id),
          trashing.operations[0].key,
        ),
      ).toMatchObject({
        status: 'reverted',
        revertedByProposalId: restoring._id,
      });

      const trashingAgain = await revertSingle(restoring);
      expect(trashingAgain.operations.map((op) => op.type)).toEqual(['trash']);
      expect((await kit.findPage(pageId)).path).toBe(`/trash${path}`);
    });

    it('puts the proposed body back when the revert of an edit is reverted', async () => {
      const page = await kit.createPage('編集/戻し');
      const original = await applyOriginal([
        kit.editInput(page, '提案の本文 😀'),
      ]);

      const reverting = await revertSingle(original);
      expect(await latestBodyOf(page._id.toString())).toBe('base body');

      await revertSingle(reverting);
      expect(await latestBodyOf(page._id.toString())).toBe('提案の本文 😀');
    });

    it('refuses to restore with not-in-trash once the page was restored by hand', async () => {
      const original = await applyOriginal([
        { type: 'create', path: kit.nextPath('restored-by-hand'), body: 'b' },
      ]);
      const trashing = await revertSingle(original);
      const trashed = await kit.findPage(createdPageIdOf(original));
      await crowi.pageService.revertDeletedPage(
        trashed,
        users.other,
        {},
        false,
        {
          ip: TEST_IP,
        },
      );
      await kit.waitForPageOperationsToFinish();

      await expectRefused(trashing, 'not-in-trash');
    });

    it('refuses to restore with original-path-occupied once a page sits where the trashed page was', async () => {
      const path = kit.nextPath('restore-occupied');
      const original = await applyOriginal([
        { type: 'create', path, body: 'b' },
      ]);
      const trashing = await revertSingle(original);
      await createPageAt(path);

      await expectRefused(trashing, 'original-path-occupied');
    });

    it('restores when only an empty page holds the path the trashed page had', async () => {
      const path = kit.nextPath('restore-placeholder');
      const original = await applyOriginal([
        { type: 'create', path, body: 'b' },
      ]);
      const trashing = await revertSingle(original);
      await createPageAt(`${path}/child`);
      expect(await Page().exists({ path, isEmpty: true })).not.toBeNull();

      await revertSingle(trashing);

      expect((await kit.findPage(createdPageIdOf(original))).path).toBe(path);
    });
  });
});
