import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalView,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.161';
const PREFIX = '/cp-service-get-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.getForViewer', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceGetRequester',
      subscriber: 'cpServiceGetViewer',
      other: 'cpServiceGetOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const viewOf = (result: ServiceResult<ChangeProposalView>) => {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

  const applyKeys = async (
    proposal: ChangeProposalDocument,
    keys: readonly string[],
  ): Promise<ChangeProposalDocument> => {
    await prisma.changeproposals.markApproved(
      proposal._id,
      proposal.requester,
      keys,
      new Date(),
    );
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const applyAll = async (
    operations: readonly CreateOperationInput[],
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const createPageAs = async (
    owner: IUserHasId,
    label: string,
    grant: PageGrant,
  ) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      owner,
      { grant },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

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
    await kit.resetPerPageNotificationsSetting();
  });

  afterAll(async () => {
    const trashed = await Page().find({
      path: new RegExp(`^/trash${PREFIX}/`),
    });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: trashed.map((p) => p._id.toString()) } },
    });
    await Page().deleteMany({ _id: { $in: trashed.map((p) => p._id) } });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await kit.tearDown();
  });

  describe('what the requester sees', () => {
    it('returns every operation with its order, body, outcome details and requester state', async () => {
      const edited = await kit.createPage('req-edit');
      const pending = await kit.createPage('req-pending');
      const proposal = await kit.storeProposal(
        [
          kit.editInput(edited, 'applied body'),
          { type: 'create', path: edited.path, body: 'occupied path' },
          kit.editInput(pending, 'waiting body'),
        ],
        { approve: false, perPageNotifications: true },
      );
      const stored = await applyKeys(proposal, [
        keyOf(proposal, 0),
        keyOf(proposal, 1),
      ]);
      await configManager.updateConfigs({
        'changeProposal:perPageNotificationsEnabled': true,
      });

      const view = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      expect(view).toMatchObject({
        id: proposal._id,
        requester: {
          id: users.requester._id.toString(),
          username: users.requester.username,
          name: users.requester.name,
        },
        entry: 'ai-chat',
        isRequester: true,
        status: 'pending',
        lastAppliedAt: stored.lastAppliedAt?.toISOString(),
        requesterState: {
          lifecycle: 'open',
          achievement: { applied: 1, attempted: 3 },
          perPageNotifications: { value: true, isEnabledBySettings: true },
        },
      });
      expect(view.operations).toEqual([
        expect.objectContaining({
          key: keyOf(proposal, 0),
          index: 0,
          type: 'edit',
          status: 'applied',
          proposedBody: 'applied body',
          page: { id: edited._id.toString(), path: edited.path },
          revertability: { revertible: true },
        }),
        expect.objectContaining({
          key: keyOf(proposal, 1),
          index: 1,
          type: 'create',
          status: 'failed',
          reason: 'path-occupied',
          path: edited.path,
          proposedBody: 'occupied path',
        }),
        expect.objectContaining({
          key: keyOf(proposal, 2),
          index: 2,
          status: 'pending',
          proposedBody: 'waiting body',
        }),
      ]);
      expect(view.operations[1]).not.toHaveProperty('page');
    });

    it('reports the per-page notification setting as off when the admin turned it off', async () => {
      const page = await kit.createPage('req-setting-off');
      const proposal = await kit.storeProposal([kit.editInput(page)], {
        approve: false,
        perPageNotifications: true,
      });

      const view = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      expect(view.requesterState?.perPageNotifications).toEqual({
        value: true,
        isEnabledBySettings: false,
      });
    });

    it('omits the achievement for a revert proposal', async () => {
      const page = await kit.createPage('req-revert');
      const original = await applyAll([kit.editInput(page)]);
      const reverted = await service.revert(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );
      await kit.waitForPageOperationsToFinish();
      if (!reverted.ok || reverted.value.revertProposalId == null) {
        throw new Error('revert failed');
      }

      const view = viewOf(
        await service.getForViewer(
          reverted.value.revertProposalId,
          users.requester,
        ),
      );

      expect(view.revertOf).toBe(original._id);
      expect(view.requesterState).toBeDefined();
      expect(view.requesterState).not.toHaveProperty('achievement');
    });
  });

  describe('what a viewer who may not revert sees', () => {
    const READ_ONLY_USERNAME = 'cpServiceGetReadOnly';
    let readOnlyUser: IUserHasId;

    beforeAll(async () => {
      readOnlyUser = await mongoose.model<IUserHasId>('User').create({
        name: READ_ONLY_USERNAME,
        username: READ_ONLY_USERNAME,
        email: `${READ_ONLY_USERNAME}@example.com`,
        status: UserStatus.STATUS_ACTIVE,
        readOnly: true,
      });
    });

    afterAll(async () => {
      await mongoose.model('User').deleteMany({ username: READ_ONLY_USERNAME });
    });

    it('returns the applied operation without any revertability to a read-only user', async () => {
      const page = await kit.createPage('read-only-viewer');
      const proposal = await applyAll([kit.editInput(page)]);

      const view = viewOf(
        await service.getForViewer(proposal._id, readOnlyUser),
      );

      expect(view.operations).toEqual([
        expect.objectContaining({ key: keyOf(proposal, 0), status: 'applied' }),
      ]);
      expect(view.operations[0]).not.toHaveProperty('revertability');
    });
  });

  describe('what another viewer sees', () => {
    it('returns only the applied operations on pages the viewer can see, with status and lastAppliedAt from those alone', async () => {
      const shared = await kit.createPage('other-shared');
      const hidden = await createPageAs(
        users.requester,
        'other-hidden',
        PageGrant.GRANT_OWNER,
      );
      const waiting = await kit.createPage('other-waiting');
      const sharedInput = kit.editInput(shared, 'shared body');
      const proposal = await kit.storeProposal(
        [
          sharedInput,
          kit.editInput(hidden, 'hidden body'),
          kit.editInput(waiting, 'waiting body'),
        ],
        { approve: false },
      );
      const first = await applyKeys(proposal, [keyOf(proposal, 0)]);
      const sharedAppliedAt = first.operations[0].appliedAt;
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      const stored = await applyKeys(proposal, [keyOf(proposal, 1)]);
      expect(stored.lastAppliedAt).not.toEqual(sharedAppliedAt);

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(view).toMatchObject({
        isRequester: false,
        status: 'applied',
        lastAppliedAt: sharedAppliedAt?.toISOString(),
      });
      expect(view).not.toHaveProperty('requesterState');
      expect(view.operations).toEqual([
        {
          key: keyOf(proposal, 0),
          type: 'edit',
          status: 'applied',
          appliedAt: sharedAppliedAt?.toISOString(),
          page: { id: shared._id.toString(), path: shared.path },
          baseRevisionId:
            sharedInput.type === 'edit' ? sharedInput.baseRevisionId : null,
          resultRevisionId: stored.operations[0].resultRevisionId,
          revertability: { revertible: true },
        },
      ]);
      // Nothing in the response hints at the hidden or pending operations.
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(hidden.path);
      expect(serialized).not.toContain(waiting.path);
      expect(serialized).not.toContain(keyOf(proposal, 1));
      expect(serialized).not.toContain(keyOf(proposal, 2));
    });

    it('tells the viewer whether an applied operation can still be reverted right now', async () => {
      const page = await kit.createPage('other-edited-after');
      const proposal = await applyAll([kit.editInput(page)]);
      await crowi.pageService.updatePage(
        await kit.findPage(page._id),
        'edited by hand',
        'proposed body',
        users.other,
        {},
      );

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(view.operations[0].revertability).toEqual({
        revertible: false,
        reason: 'edited-after-apply',
      });
    });

    it('hides operations on pages only people with the link may view', async () => {
      const restricted = await createPageAs(
        users.requester,
        'other-restricted',
        PageGrant.GRANT_RESTRICTED,
      );
      const proposal = await applyAll([kit.editInput(restricted)]);
      expect(proposal.operations[0].status).toBe('applied');

      const forViewer = await service.getForViewer(
        proposal._id,
        users.subscriber,
      );
      const forRequester = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      expect(forViewer).toEqual({ ok: false, error: { code: 'not-found' } });
      expect(forRequester.operations.map((op) => op.key)).toEqual([
        keyOf(proposal, 0),
      ]);
    });

    it('keeps a reverted create whose page now sits in the trash', async () => {
      const path = kit.nextPath('日本語　ページ（作成）');
      const original = await applyAll([{ type: 'create', path, body: '本文' }]);
      await service.revert(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );
      await kit.waitForPageOperationsToFinish();

      const view = viewOf(
        await service.getForViewer(original._id, users.subscriber),
      );

      expect(view.status).toBe('reverted');
      expect(view.operations).toEqual([
        expect.objectContaining({
          type: 'create',
          status: 'reverted',
          path,
          page: {
            id: original.operations[0].resultPageId,
            path: `/trash${path}`,
          },
        }),
      ]);
      expect(view.operations[0]).not.toHaveProperty('revertability');
    });
  });

  describe('when there is nothing to show', () => {
    it('answers a viewer who can see nothing exactly as for a missing or malformed id', async () => {
      const hidden = await createPageAs(
        users.requester,
        'none-hidden',
        PageGrant.GRANT_OWNER,
      );
      const waiting = await kit.createPage('none-waiting');
      const proposal = await kit.storeProposal(
        [kit.editInput(hidden), kit.editInput(waiting)],
        { approve: false },
      );
      await applyKeys(proposal, [keyOf(proposal, 0)]);

      const results = await Promise.all([
        service.getForViewer(proposal._id, users.subscriber),
        service.getForViewer(
          new mongoose.Types.ObjectId().toString(),
          users.subscriber,
        ),
        service.getForViewer('not-an-id', users.subscriber),
      ]);

      for (const result of results) {
        expect(result).toEqual({ ok: false, error: { code: 'not-found' } });
      }
    });

    it('still answers the requester even when every operation is still pending', async () => {
      const page = await kit.createPage('none-requester');
      const proposal = await kit.storeProposal([kit.editInput(page)], {
        approve: false,
      });

      const view = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      expect(view.status).toBe('pending');
      expect(view).not.toHaveProperty('lastAppliedAt');
    });
  });
});
