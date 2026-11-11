import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.153';
const PREFIX = '/cp-service-approve-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.approve', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceApproveRequester',
      subscriber: 'cpServiceApproveSubscriber',
      other: 'cpServiceApproveOther',
    },
  });
  const { users } = kit;

  const storeWaiting = (operations: readonly CreateOperationInput[]) =>
    kit.storeProposal(operations, { approve: false });

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

  const approvalsOf = async (id: string) =>
    (await kit.reload(id)).operations.map((op) => op.approvedAt);

  const createInput = (label: string): CreateOperationInput => ({
    type: 'create',
    path: kit.nextPath(label),
    body: '新しい本文',
  });

  // A proposal whose lifecycle was closed the way the maintenance cron closes it.
  const storeClosed = async (closing: 'expired' | 'withdrawn') => {
    const page = await kit.createPage(`closed-${closing}`);
    const created = await prisma.changeproposals.createProposal({
      requester: users.requester._id.toString(),
      entry: 'ai-chat',
      perPageNotifications: false,
      expiresAt: new Date(Date.now() - 1000),
      operations: [kit.editInput(page)],
    });
    expect(
      await prisma.changeproposals.closeIfStillOpen(
        created._id,
        closing,
        new Date(),
      ),
    ).toBe(true);
    return created;
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
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: {
        requester: {
          in: [users.requester._id.toString(), users.other._id.toString()],
        },
      },
    });
    await kit.tearDown();
  });

  describe('what gets approved and applied', () => {
    it('applies only the chosen page and leaves the rest waiting without approval', async () => {
      const pageA = await kit.createPage('page-level-a');
      const pageB = await kit.createPage('page-level-b');
      const proposal = await storeWaiting([
        kit.editInput(pageA, 'A の新しい本文'),
        kit.editInput(pageB),
        createInput('page-level-new'),
      ]);
      const chosen = keyOf(proposal, 0);

      const result = await service.approve(
        proposal._id,
        users.requester,
        [chosen],
        BACKGROUND,
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [{ key: chosen, status: 'applied' }] },
      });
      const stored = await kit.reload(proposal._id);
      expect(
        stored.operations.map((op) => [op.status, op.approvedAt != null]),
      ).toEqual([
        ['applied', true],
        ['pending', false],
        ['pending', false],
      ]);
      expect(stored.lifecycle).toBe('open');
      expect(await kit.markedRevisions(proposal._id, chosen)).toHaveLength(1);
      expect(
        await kit.markedRevisions(proposal._id, keyOf(proposal, 1)),
      ).toEqual([]);
    });

    it('expands a chosen operation to the other pending operations on the same page', async () => {
      const page = await kit.createPage('expand');
      const other = await kit.createPage('expand-other');
      const toPath = kit.nextPath('expand-moved');
      const proposal = await storeWaiting([
        kit.editInput(page),
        kit.editInput(other),
        {
          type: 'move',
          pageId: page._id.toString(),
          fromPath: page.path,
          toPath,
        },
      ]);

      const result = await service.approve(
        proposal._id,
        users.requester,
        [keyOf(proposal, 0)],
        BACKGROUND,
      );

      expect(result.ok).toBe(true);
      const stored = await kit.reload(proposal._id);
      expect(stored.operations.map((op) => op.status)).toEqual([
        'applied',
        'pending',
        'applied',
      ]);
      expect((await kit.findPage(page._id)).path).toBe(toPath);
    });

    it('applies every pending operation and settles the proposal when approved as a whole', async () => {
      const page = await kit.createPage('all');
      const proposal = await storeWaiting([
        kit.editInput(page),
        createInput('all-new'),
      ]);

      const result = await service.approve(
        proposal._id,
        users.requester,
        'all',
        BACKGROUND,
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: expect.arrayContaining([
            { key: keyOf(proposal, 0), status: 'applied' },
            { key: keyOf(proposal, 1), status: 'applied' },
          ]),
        },
      });
      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('settled');
      expect(stored.operations.map((op) => op.status)).toEqual([
        'applied',
        'applied',
      ]);
    });

    it('does not re-apply an operation that is no longer pending', async () => {
      const page = await kit.createPage('twice');
      const other = await kit.createPage('twice-other');
      const proposal = await storeWaiting([
        kit.editInput(page),
        kit.editInput(other),
      ]);
      const first = keyOf(proposal, 0);
      await service.approve(proposal._id, users.requester, [first], BACKGROUND);
      const revisionAfterFirst = (await kit.findPage(page._id)).revision;

      const again = await service.approve(
        proposal._id,
        users.requester,
        [first],
        BACKGROUND,
      );

      expect(again).toEqual({
        ok: true,
        value: { type: 'done', results: [] },
      });
      expect(await kit.markedRevisions(proposal._id, first)).toHaveLength(1);
      expect((await kit.findPage(page._id)).revision).toEqual(
        revisionAfterFirst,
      );
      const untouched = kit.operationOf(
        await kit.reload(proposal._id),
        keyOf(proposal, 1),
      );
      expect([untouched.status, untouched.approvedAt]).toEqual([
        'pending',
        undefined,
      ]);
    });

    it('ignores keys the proposal does not have', async () => {
      const page = await kit.createPage('unknown-key');
      const proposal = await storeWaiting([kit.editInput(page)]);

      const result = await service.approve(
        proposal._id,
        users.requester,
        ['no-such-key'],
        BACKGROUND,
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [] },
      });
      expect(await approvalsOf(proposal._id)).toEqual([undefined]);
    });

    it('keeps the approval for the running apply when another run holds the lease', async () => {
      const page = await kit.createPage('leased');
      const proposal = await storeWaiting([kit.editInput(page)]);
      const token = 'cp-service-approve-held-lease';
      expect(
        await prisma.changeproposals.claimApplyLease(
          proposal._id,
          token,
          new Date(),
        ),
      ).toBe(true);

      try {
        const result = await service.approve(
          proposal._id,
          users.requester,
          'all',
          BACKGROUND,
        );

        expect(result).toEqual({ ok: true, value: { type: 'in-progress' } });
        const op = kit.operationOf(
          await kit.reload(proposal._id),
          keyOf(proposal, 0),
        );
        expect(op.status).toBe('pending');
        expect(op.approvedAt).toBeInstanceOf(Date);
      } finally {
        await prisma.changeproposals.releaseApplyLease(proposal._id, token);
      }
    });
  });

  describe('who may approve, and when', () => {
    it('answers "not found" to a user other than the requester and approves nothing', async () => {
      const page = await kit.createPage('other-user');
      const proposal = await storeWaiting([kit.editInput(page)]);

      const result = await service.approve(
        proposal._id,
        users.other,
        'all',
        BACKGROUND,
      );

      expect(result).toEqual({ ok: false, error: { code: 'not-found' } });
      expect(await approvalsOf(proposal._id)).toEqual([undefined]);
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'pending',
      );
    });

    it('answers "not found" to another user even when the proposal is no longer open', async () => {
      const proposal = await storeClosed('expired');

      const result = await service.approve(
        proposal._id,
        users.other,
        'all',
        BACKGROUND,
      );

      expect(result).toEqual({ ok: false, error: { code: 'not-found' } });
    });

    it.each([
      ['a malformed id', 'not-an-object-id'],
      ['an id no proposal has', new mongoose.Types.ObjectId().toString()],
    ])('answers "not found" for %s', async (_label, id) => {
      expect(
        await service.approve(id, users.requester, 'all', BACKGROUND),
      ).toEqual({ ok: false, error: { code: 'not-found' } });
    });

    it.each([
      'expired',
      'withdrawn',
    ] as const)('refuses a %s proposal as "not open" and approves nothing', async (closing) => {
      const proposal = await storeClosed(closing);

      const result = await service.approve(
        proposal._id,
        users.requester,
        'all',
        BACKGROUND,
      );

      expect(result).toEqual({ ok: false, error: { code: 'not-open' } });
      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe(closing);
      expect(stored.operations.map((op) => [op.status, op.approvedAt])).toEqual(
        [['skipped', undefined]],
      );
    });

    it('refuses a settled proposal as "not open"', async () => {
      const page = await kit.createPage('settled');
      const proposal = await storeWaiting([kit.editInput(page)]);
      await service.approve(proposal._id, users.requester, 'all', BACKGROUND);
      expect((await kit.reload(proposal._id)).lifecycle).toBe('settled');

      expect(
        await service.approve(proposal._id, users.requester, 'all', BACKGROUND),
      ).toEqual({ ok: false, error: { code: 'not-open' } });
    });

    it('refuses a discarded proposal as "not open"', async () => {
      const page = await kit.createPage('discarded');
      const proposal = await storeWaiting([kit.editInput(page)]);
      expect(await service.discard(proposal._id, users.requester)).toEqual({
        ok: true,
        value: undefined,
      });

      expect(
        await service.approve(proposal._id, users.requester, 'all', BACKGROUND),
      ).toEqual({ ok: false, error: { code: 'not-open' } });
      expect(await approvalsOf(proposal._id)).toEqual([undefined]);
    });
  });
});
