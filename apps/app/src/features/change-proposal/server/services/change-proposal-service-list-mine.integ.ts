import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import {
  createApplierTestKit,
  type StoreProposalOptions,
} from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.162';
const PREFIX = '/cp-service-list-mine-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.listMine', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceListMineRequester',
      subscriber: 'cpServiceListMineViewer',
      other: 'cpServiceListMineOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');
  const User = () => mongoose.model<IUserHasId>('User');
  const freshUsernames: string[] = [];

  // Each test lists its own requester's proposals, so earlier tests never leak in.
  const freshRequester = (label: string): Promise<IUserHasId> => {
    const username = `cpListMine${label}${freshUsernames.length}`;
    freshUsernames.push(username);
    return User().create({
      name: `${label} 名前`,
      username,
      email: `${username}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
  };

  const storeAs = (
    requester: IUserHasId,
    operations: readonly CreateOperationInput[],
    options: StoreProposalOptions = {},
  ): Promise<ChangeProposalDocument> =>
    kit.storeProposal(operations, {
      ...options,
      requester: requester._id.toString(),
    });

  const applyAllAs = async (
    requester: IUserHasId,
    operations: readonly CreateOperationInput[],
  ): Promise<ChangeProposalDocument> => {
    const proposal = await storeAs(requester, operations);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
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
    const freshIds = (
      await User().find({ username: { $in: freshUsernames } }, { _id: 1 })
    ).map((u) => u._id.toString());
    await prisma.changeproposals.deleteMany({
      where: { requester: { in: freshIds } },
    });
    await User().deleteMany({ username: { $in: freshUsernames } });
    await kit.tearDown();
  });

  it('returns only the viewer’s own proposals, newest first, one page at a time', async () => {
    const requester = await freshRequester('Paging');
    const page = await kit.createPage('paging');
    const first = await storeAs(requester, [kit.editInput(page)]);
    const second = await storeAs(requester, [kit.editInput(page)]);
    const third = await storeAs(requester, [kit.editInput(page)]);
    await kit.storeProposal([kit.editInput(page)], {
      requester: users.other._id.toString(),
    });

    const page1 = await service.listMine(requester, 1, 2);
    const page2 = await service.listMine(requester, 2, 2);
    const beyond = await service.listMine(requester, 3, 2);

    expect(page1.items.map((item) => item.id)).toEqual([third._id, second._id]);
    expect(page1.hasNext).toBe(true);
    expect(page2.items.map((item) => item.id)).toEqual([first._id]);
    expect(page2.hasNext).toBe(false);
    expect(beyond).toEqual({ items: [], hasNext: false });
  });

  it('reports no next page when the page holds exactly the remaining proposals', async () => {
    const requester = await freshRequester('Exact');
    const page = await kit.createPage('exact');
    await storeAs(requester, [kit.editInput(page)]);
    await storeAs(requester, [kit.editInput(page)]);

    const result = await service.listMine(requester, 1, 2);

    expect(result.items).toHaveLength(2);
    expect(result.hasNext).toBe(false);
  });

  it('returns an empty list to a viewer who has made no proposals', async () => {
    const requester = await freshRequester('Empty');

    expect(await service.listMine(requester, 1, 10)).toEqual({
      items: [],
      hasNext: false,
    });
  });

  it('summarises each proposal with the requester state and the pages it touches', async () => {
    const requester = await freshRequester('Summary');
    const edited = await kit.createPage('日本語　ページ（編集）');
    const waiting = await kit.createPage('summary-waiting');
    const proposal = await storeAs(
      requester,
      [kit.editInput(edited, '本文'), kit.editInput(waiting)],
      { approve: false, perPageNotifications: true },
    );
    await prisma.changeproposals.markApproved(
      proposal._id,
      proposal.requester,
      [proposal.operations[0].key],
      new Date(),
    );
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    const stored = await kit.reload(proposal._id);
    await configManager.updateConfigs({
      'changeProposal:perPageNotificationsEnabled': true,
    });

    const { items } = await service.listMine(requester, 1, 10);

    expect(items).toEqual([
      {
        id: proposal._id,
        requester: {
          id: requester._id.toString(),
          username: requester.username,
          name: requester.name,
        },
        entry: 'ai-chat',
        createdAt: stored.createdAt.toISOString(),
        lastAppliedAt: stored.lastAppliedAt?.toISOString(),
        status: 'pending',
        isRequester: true,
        requesterState: {
          lifecycle: 'open',
          achievement: { applied: 1, attempted: 2 },
          perPageNotifications: { value: true, isEnabledBySettings: true },
        },
        pages: [
          { id: edited._id.toString(), path: edited.path },
          { id: waiting._id.toString(), path: waiting.path },
        ],
      },
    ]);
  });

  it('leaves pages the requester can no longer view out of the pages, status and achievement', async () => {
    const requester = await freshRequester('LostAccess');
    const kept = await kit.createPage('lost-kept');
    const lost = await kit.createPage('lost-hidden');
    const proposal = await applyAllAs(requester, [
      kit.editInput(kept),
      kit.editInput(lost),
    ]);
    expect(proposal.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
    ]);
    await Page().updateOne(
      { _id: lost._id },
      { grant: PageGrant.GRANT_OWNER, grantedUsers: [users.other._id] },
    );

    const { items } = await service.listMine(requester, 1, 10);

    expect(items).toEqual([
      expect.objectContaining({
        id: proposal._id,
        status: 'applied',
        pages: [{ id: kept._id.toString(), path: kept.path }],
        requesterState: expect.objectContaining({
          achievement: { applied: 1, attempted: 1 },
        }),
      }),
    ]);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain(lost._id.toString());
    expect(serialized).not.toContain(lost.path);
  });

  it('keeps a proposal whose every page has become invisible to the requester', async () => {
    const requester = await freshRequester('AllLost');
    const lost = await kit.createPage('all-lost');
    const proposal = await applyAllAs(requester, [kit.editInput(lost)]);
    await Page().updateOne(
      { _id: lost._id },
      { grant: PageGrant.GRANT_OWNER, grantedUsers: [users.other._id] },
    );

    const { items } = await service.listMine(requester, 1, 10);

    expect(items.map((item) => item.id)).toEqual([proposal._id]);
    expect(items[0].pages).toEqual([]);
    // Counted over visible operations only, as in getForViewer (tasks.md 6.1 note).
    expect(items[0]).toMatchObject({
      status: 'not-applied',
      requesterState: { achievement: { applied: 0, attempted: 0 } },
    });
  });
});
