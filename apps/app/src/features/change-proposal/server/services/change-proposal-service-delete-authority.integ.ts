import type { IUserHasId } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { IPageDeleteConfigValueToProcessValidation } from '~/interfaces/page-delete-config';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalNotificationSnapshot,
  RevertResult,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.158';
const PREFIX = '/cp-service-delete-authority-integ';
const ADMIN_USERNAME = 'cpServiceDeleteAuthorityAdmin';
const BACKGROUND = { kind: 'background' } as const;

describe("ChangeProposalService.revert and the admin's page deletion authority", () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let admin: HydratedDocument<IUserHasId>;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceDeleteAuthorityAuthor',
      subscriber: 'cpServiceDeleteAuthoritySubscriber',
      other: 'cpServiceDeleteAuthorityOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const setDeletionAuthority = (
    value: IPageDeleteConfigValueToProcessValidation | undefined,
    key:
      | 'security:pageDeletionAuthority'
      | 'security:pageCompleteDeletionAuthority' = 'security:pageDeletionAuthority',
  ) =>
    configManager.updateConfigs({ [key]: value }, { removeIfUndefined: true });

  // The author's proposal creates one page; the page's creator is the author.
  const applyCreate = async (): Promise<ChangeProposalDocument> => {
    const operations: CreateOperationInput[] = [
      { type: 'create', path: kit.nextPath('created'), body: 'body' },
    ];
    const proposal = await kit.storeProposal(operations);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    const applied = await kit.reload(proposal._id);
    expect(applied.operations[0].status).toBe('applied');
    return applied;
  };

  const revertAs = async (
    proposalId: string,
    user: IUserHasId,
  ): Promise<ServiceResult<RevertResult>> => {
    const result = await service.revert(
      proposalId,
      user,
      'all-visible',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    return result;
  };

  const resultPageOf = (
    proposal: ChangeProposalDocument,
  ): Promise<HydratedDocument<PageDocument>> => {
    const pageId = proposal.operations[0].resultPageId;
    if (pageId == null) throw new Error('operation has no result page');
    return kit.findPage(pageId);
  };

  const expectNotDeletable = async (
    proposal: ChangeProposalDocument,
    user: IUserHasId,
  ): Promise<void> => {
    const [{ key }] = proposal.operations;
    const pathBefore = (await resultPageOf(proposal)).path;

    await expect(revertAs(proposal._id, user)).resolves.toEqual({
      ok: true,
      value: {
        operations: [
          { key, outcome: 'revert-refused', reason: 'not-deletable' },
        ],
      },
    });
    expect(kit.operationOf(await kit.reload(proposal._id), key)).toMatchObject({
      status: 'revert-refused',
      reason: 'not-deletable',
    });
    expect((await resultPageOf(proposal)).path).toBe(pathBefore);
    expect(
      await prisma.changeproposals.count({ where: { revertOf: proposal._id } }),
    ).toBe(0);
  };

  const expectReverted = async (
    proposal: ChangeProposalDocument,
    user: IUserHasId,
  ): Promise<string> => {
    const [{ key }] = proposal.operations;
    const result = await revertAs(proposal._id, user);
    expect(result).toMatchObject({
      ok: true,
      value: { operations: [{ key, outcome: 'reverted' }] },
    });
    if (!result.ok || result.value.revertProposalId == null) {
      throw new Error('no revert proposal was created');
    }
    return result.value.revertProposalId;
  };

  const expectDeletedCompletely = async (proposal: ChangeProposalDocument) => {
    const pageId = proposal.operations[0].resultPageId;
    expect(await Page().exists({ _id: pageId })).toBeNull();
  };

  const revertabilityFor = async (proposalId: string, viewer: IUserHasId) => {
    const view = await service.getForViewer(proposalId, viewer);
    if (!view.ok) throw new Error('the viewer could not read the proposal');
    return view.value.operations[0].revertability;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    admin = await mongoose.model<IUserHasId>('User').create({
      name: ADMIN_USERNAME,
      username: ADMIN_USERNAME,
      email: `${ADMIN_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      admin: true,
    });
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
    await setDeletionAuthority(undefined);
    await setDeletionAuthority(
      undefined,
      'security:pageCompleteDeletionAuthority',
    );
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
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
    await prisma.changeproposals.deleteMany({
      where: {
        requester: {
          in: [users.requester, users.other, admin].map((u) =>
            u._id.toString(),
          ),
        },
      },
    });
    await mongoose.model('User').deleteMany({ username: ADMIN_USERNAME });
    await kit.tearDown();
  });

  describe('when only admins may delete pages', () => {
    beforeEach(async () => {
      await setDeletionAuthority('adminOnly');
    });

    it('refuses with not-deletable when another user reverts a create, leaving the page in place', async () => {
      const proposal = await applyCreate();

      await expectNotDeletable(proposal, users.other);
    });

    it('refuses the author too, since a human could not delete the page either', async () => {
      const proposal = await applyCreate();

      await expectNotDeletable(proposal, users.requester);
    });

    it('lets an admin revert', async () => {
      const proposal = await applyCreate();

      await expectReverted(proposal, admin);
      await expectDeletedCompletely(proposal);
    });

    it('shows the create as not revertible to a non-admin viewer and revertible to an admin', async () => {
      const proposal = await applyCreate();

      await expect(
        revertabilityFor(proposal._id, users.other),
      ).resolves.toEqual({ revertible: false, reason: 'not-deletable' });
      await expect(revertabilityFor(proposal._id, admin)).resolves.toEqual({
        revertible: true,
      });
    });
  });

  describe('when only admins may delete pages completely, while anyone may move them to the trash', () => {
    beforeEach(async () => {
      await setDeletionAuthority(
        'adminOnly',
        'security:pageCompleteDeletionAuthority',
      );
    });

    it('refuses the author with not-deletable and shows the create as not revertible, leaving the page in place', async () => {
      const proposal = await applyCreate();

      await expect(
        revertabilityFor(proposal._id, users.requester),
      ).resolves.toEqual({ revertible: false, reason: 'not-deletable' });
      await expectNotDeletable(proposal, users.requester);
    });

    it('lets an admin revert', async () => {
      const proposal = await applyCreate();

      await expect(revertabilityFor(proposal._id, admin)).resolves.toEqual({
        revertible: true,
      });
      await expectReverted(proposal, admin);
      await expectDeletedCompletely(proposal);
    });
  });

  describe('when admins and the author may delete pages', () => {
    beforeEach(async () => {
      await setDeletionAuthority('adminAndAuthor');
    });

    it('refuses another user with not-deletable', async () => {
      const proposal = await applyCreate();

      await expectNotDeletable(proposal, users.other);
    });

    it("lets the page's author revert", async () => {
      const proposal = await applyCreate();

      await expectReverted(proposal, users.requester);
      await expectDeletedCompletely(proposal);
    });
  });

  it('tells the original requester, by the path they asked to create, when another user reverts the create', async () => {
    const proposal = await applyCreate();
    const [created] = proposal.operations;
    if (created.type !== 'create') throw new Error('expected a create');
    const { path, resultPageId } = created;

    const revertProposalId = await expectReverted(proposal, users.other);

    await vi.waitFor(
      async () => {
        const notifications =
          await kit.aggregatedNotifications(revertProposalId);
        expect(
          notifications.map((n) => ({
            user: String(n.user),
            pages: (
              JSON.parse(n.snapshot) as ChangeProposalNotificationSnapshot
            ).pages,
          })),
        ).toEqual([
          {
            user: users.requester._id.toString(),
            pages: [{ id: resultPageId, path }],
          },
        ]);
      },
      { timeout: 5000, interval: 50 },
    );
  });

  describe('the proposal each revert notification points at', () => {
    const notifiedProposals = async (revertProposalId: string) => {
      const notifications = await kit.aggregatedNotifications(revertProposalId);
      return notifications.map((n) => ({
        user: String(n.user),
        proposalId: (
          JSON.parse(n.snapshot) as ChangeProposalNotificationSnapshot
        ).proposalId,
      }));
    };

    const recipientOf = (userId: string): IUserHasId => {
      const recipient = [users.requester, users.subscriber, users.other].find(
        (user) => user._id.toString() === userId,
      );
      if (recipient == null) throw new Error(`unexpected recipient ${userId}`);
      return recipient;
    };

    // The viewer links a notification to snapshot.proposalId, so every recipient
    // must be able to open that proposal.
    const expectEveryRecipientCanOpen = async (revertProposalId: string) => {
      const notified = await notifiedProposals(revertProposalId);
      for (const { user, proposalId } of notified) {
        // biome-ignore lint/performance/noAwaitInLoops: a few recipients, read one by one
        const view = await service.getForViewer(proposalId, recipientOf(user));
        expect({ user, ok: view.ok }).toEqual({ user, ok: true });
      }
      return notified;
    };

    it('lets the original requester open it when the revert only deleted a page they had created', async () => {
      const proposal = await applyCreate();

      const revertProposalId = await expectReverted(proposal, users.other);

      const notified = await expectEveryRecipientCanOpen(revertProposalId);
      expect(notified).toEqual([
        { user: users.requester._id.toString(), proposalId: proposal._id },
      ]);
      expect(
        (await service.getForViewer(revertProposalId, users.other)).ok,
      ).toBe(true);
    });

    it('lets the original requester and a subscriber of a remaining page open it', async () => {
      const edited = await kit.createPage('contract-edited');
      await kit.subscribe(edited);
      const proposal = await kit.storeProposal([
        { type: 'create', path: kit.nextPath('contract-created'), body: 'b' },
        kit.editInput(edited, 'proposed body'),
      ]);
      await kit.newApplier().apply(proposal._id, BACKGROUND);
      await kit.waitForPageOperationsToFinish();

      const result = await revertAs(proposal._id, users.other);
      if (!result.ok || result.value.revertProposalId == null) {
        throw new Error('no revert proposal was created');
      }
      const { revertProposalId } = result.value;

      const notified = await expectEveryRecipientCanOpen(revertProposalId);
      expect(
        [...notified].sort((a, b) => a.user.localeCompare(b.user)),
      ).toEqual(
        [
          { user: users.requester._id.toString(), proposalId: proposal._id },
          {
            user: users.subscriber._id.toString(),
            proposalId: revertProposalId,
          },
        ].sort((a, b) => a.user.localeCompare(b.user)),
      );
      expect(
        (await service.getForViewer(revertProposalId, users.other)).ok,
      ).toBe(true);
    });
  });

  describe('when anyone may delete pages', () => {
    it.each([
      ['set explicitly', 'anyOne'],
      ['left unset', undefined],
    ] as const)('lets another user revert (%s)', async (_label, value) => {
      await setDeletionAuthority(value);
      const proposal = await applyCreate();

      await expect(
        revertabilityFor(proposal._id, users.other),
      ).resolves.toEqual({ revertible: true });
      await expectReverted(proposal, users.other);
      await expectDeletedCompletely(proposal);
    });
  });
});
