import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalSummaryView,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import {
  createApplierTestKit,
  type StoreProposalOptions,
} from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.163';
const PREFIX = '/cp-service-list-applied-integ';
const BACKGROUND = { kind: 'background' } as const;
const MAX_PAGES_TO_FOLLOW = 50;

describe('ChangeProposalService.listAppliedVisible', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceListAppliedRequester',
      subscriber: 'cpServiceListAppliedViewer',
      other: 'cpServiceListAppliedOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const wait = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

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
    options: StoreProposalOptions = {},
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations, options);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    const stored = await kit.reload(proposal._id);
    expect(stored.operations.every((op) => op.status === 'applied')).toBe(true);
    return stored;
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

  // The list spans the whole worker DB, other files' rows included, so the walk
  // stops as soon as every awaited id has shown up.
  const listUntil = async (
    target: ChangeProposalService,
    viewer: IUserHasId,
    limit: number,
    awaitedIds: readonly string[],
  ): Promise<ChangeProposalSummaryView[]> => {
    const items: ChangeProposalSummaryView[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES_TO_FOLLOW; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: following the cursor page by page
      const result = await target.listAppliedVisible(viewer, cursor, limit);
      items.push(...result.items);
      const seen = new Set(items.map((item) => item.id));
      if (result.nextCursor == null || awaitedIds.every((id) => seen.has(id))) {
        return items;
      }
      cursor = result.nextCursor;
    }
    throw new Error('the cursor never ran out');
  };

  const onlyIds = (
    items: readonly ChangeProposalSummaryView[],
    ids: readonly string[],
  ): ChangeProposalSummaryView[] =>
    items.filter((item) => ids.includes(item.id));

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
    await prisma.changeproposals.deleteMany({
      where: { requester: users.other._id.toString() },
    });
    await kit.tearDown();
  });

  it('shows another viewer only applied proposals on pages they can see, built from those operations alone', async () => {
    const shared = await kit.createPage('日本語　共有（ページ）');
    const hidden = await createPageAs(
      users.requester,
      'summary-hidden',
      PageGrant.GRANT_OWNER,
    );
    const waiting = await kit.createPage('summary-waiting');
    const mixed = await kit.storeProposal(
      [kit.editInput(shared), kit.editInput(hidden), kit.editInput(waiting)],
      { approve: false },
    );
    const first = await applyKeys(mixed, [mixed.operations[0].key]);
    const sharedAppliedAt = first.operations[0].appliedAt;
    await wait(20);
    const stored = await applyKeys(mixed, [mixed.operations[1].key]);
    expect(stored.lastAppliedAt).not.toEqual(sharedAppliedAt);

    const items = onlyIds(
      await listUntil(service, users.subscriber, 50, [mixed._id]),
      [mixed._id],
    );

    expect(items).toEqual([
      {
        id: mixed._id,
        requester: {
          id: users.requester._id.toString(),
          username: users.requester.username,
          name: users.requester.name,
        },
        entry: 'ai-chat',
        createdAt: mixed.createdAt.toISOString(),
        lastAppliedAt: sharedAppliedAt?.toISOString(),
        status: 'applied',
        isRequester: false,
        pages: [{ id: shared._id.toString(), path: shared.path }],
      },
    ]);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain(hidden.path);
    expect(serialized).not.toContain(hidden._id.toString());
    expect(serialized).not.toContain(waiting.path);
  });

  it('leaves out proposals the viewer cannot see at all and those only on pages for people with the link', async () => {
    const hidden = await createPageAs(
      users.requester,
      'absent-hidden',
      PageGrant.GRANT_OWNER,
    );
    const restricted = await createPageAs(
      users.requester,
      'absent-restricted',
      PageGrant.GRANT_RESTRICTED,
    );
    const pending = await kit.createPage('absent-pending');
    const onHidden = await applyAll([kit.editInput(hidden)]);
    const onRestricted = await applyAll([kit.editInput(restricted)]);
    const notApplied = await kit.storeProposal([kit.editInput(pending)], {
      approve: false,
    });
    const ids = [onHidden._id, onRestricted._id, notApplied._id];

    const forViewer = onlyIds(
      await listUntil(service, users.subscriber, 50, ids),
      ids,
    );
    const forRequester = onlyIds(
      await listUntil(service, users.requester, 50, [
        onRestricted._id,
        onHidden._id,
      ]),
      ids,
    );

    expect(forViewer).toEqual([]);
    expect(forRequester.map((item) => item.id)).toEqual([
      onRestricted._id,
      onHidden._id,
    ]);
  });

  it('gives the stage and achievement only on the viewer’s own proposals', async () => {
    const mine = await kit.createPage('state-mine');
    const theirs = await kit.createPage('state-theirs');
    const own = await applyAll([kit.editInput(mine)]);
    const others = await applyAll([kit.editInput(theirs)], {
      requester: users.other._id.toString(),
    });

    const items = onlyIds(
      await listUntil(service, users.requester, 50, [own._id, others._id]),
      [own._id, others._id],
    );

    expect(items.map((item) => item.id)).toEqual([others._id, own._id]);
    expect(items[0].isRequester).toBe(false);
    expect(items[0]).not.toHaveProperty('requesterState');
    expect(items[1]).toMatchObject({
      isRequester: true,
      lastAppliedAt: own.lastAppliedAt?.toISOString(),
      requesterState: {
        lifecycle: 'settled',
        achievement: { applied: 1, attempted: 1 },
      },
    });
  });

  it('pages through the list with the cursor, newest application first, without repeating', async () => {
    const pages = await Promise.all(
      ['page-a', 'page-b', 'page-c'].map((label) => kit.createPage(label)),
    );
    const proposals: ChangeProposalDocument[] = [];
    for (const page of pages) {
      // biome-ignore lint/performance/noAwaitInLoops: each proposal must be applied after the previous one
      proposals.push(await applyAll([kit.editInput(page)]));
    }
    const ids = proposals.map((p) => p._id);

    const first = await service.listAppliedVisible(users.subscriber, null, 1);
    const all = await listUntil(service, users.subscriber, 1, ids);

    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    expect(onlyIds(all, ids).map((item) => item.id)).toEqual(
      [...ids].reverse(),
    );
    const seen = all.map((item) => item.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('stops after reading the scan limit and hands back a cursor to continue from', async () => {
    const limited = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
      appliedListScan: { batchSize: 2, limit: 5 },
    });
    const visiblePage = await kit.createPage('scan-visible');
    const visible = await applyAll([kit.editInput(visiblePage)]);
    const hiddenPages = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        createPageAs(
          users.requester,
          `scan-hidden-${n}`,
          PageGrant.GRANT_OWNER,
        ),
      ),
    );
    for (const page of hiddenPages) {
      // biome-ignore lint/performance/noAwaitInLoops: each must be applied after the visible one
      await applyAll([kit.editInput(page)]);
    }

    const first = await limited.listAppliedVisible(users.subscriber, null, 10);
    const all = await listUntil(limited, users.subscriber, 10, [visible._id]);

    expect(first.items.map((item) => item.id)).not.toContain(visible._id);
    expect(first.nextCursor).not.toBeNull();
    expect(all.map((item) => item.id)).toContain(visible._id);
  });

  it('returns nothing for a cursor it did not issue', async () => {
    expect(
      await service.listAppliedVisible(users.subscriber, 'not-a-cursor', 10),
    ).toEqual({ items: [], nextCursor: null });
  });

  it('leaves the page of an operation off the summary once the viewer loses access to it', async () => {
    const kept = await kit.createPage('lost-kept');
    const lost = await kit.createPage('lost-hidden');
    const proposal = await applyAll([kit.editInput(kept), kit.editInput(lost)]);
    await Page().updateOne(
      { _id: lost._id },
      { grant: PageGrant.GRANT_OWNER, grantedUsers: [users.other._id] },
    );

    const items = onlyIds(
      await listUntil(service, users.subscriber, 50, [proposal._id]),
      [proposal._id],
    );

    expect(items).toEqual([
      expect.objectContaining({
        pages: [{ id: kept._id.toString(), path: kept.path }],
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain(lost.path);
  });
});
