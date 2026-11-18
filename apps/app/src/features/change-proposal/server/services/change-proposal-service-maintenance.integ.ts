import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ProposalApplier } from './proposal-applier';
import {
  createApplierTestKit,
  type StoreProposalOptions,
} from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.158';
const PREFIX = '/cp-service-maintenance-integ';
const BACKGROUND = { kind: 'background' } as const;
const AN_HOUR_MS = 60 * 60 * 1000;
const REPEAT = 20;
const RACE_TIMEOUT_MS = 120_000;

describe('ChangeProposalService maintenance: expiry, withdrawal, resume and settling', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let applier: ProposalApplier;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceMaintenanceRequester',
      subscriber: 'cpServiceMaintenanceSubscriber',
      other: 'cpServiceMaintenanceOther',
    },
  });
  const { users } = kit;
  const now = new Date();
  const past = new Date(now.getTime() - AN_HOUR_MS);
  const future = new Date(now.getTime() + AN_HOUR_MS);

  const store = (
    operations: readonly CreateOperationInput[],
    options: StoreProposalOptions = {},
  ) => kit.storeProposal(operations, { approve: false, ...options });

  const storeEdit = async (
    label: string,
    options: StoreProposalOptions = {},
  ): Promise<ChangeProposalDocument> =>
    store([kit.editInput(await kit.createPage(label))], options);

  // An open proposal whose operations are all decided, as if a run stopped right
  // before its settle write.
  const storeStalled = async (
    label: string,
    options: StoreProposalOptions = {},
  ): Promise<ChangeProposalDocument> => {
    const proposal = await storeEdit(label, options);
    const token = `stalled-${proposal._id}`;
    await prisma.changeproposals.claimApplyLease(proposal._id, token, now);
    await prisma.changeproposals.recordOperationOutcome(
      proposal._id,
      token,
      proposal.operations[0].key,
      { status: 'failed', reason: 'write-error' },
      now,
    );
    await prisma.changeproposals.releaseApplyLease(proposal._id, token);
    const stalled = await kit.reload(proposal._id);
    expect(stalled.lifecycle).toBe('open');
    return stalled;
  };

  const holdLease = (proposalId: string, at: Date) =>
    prisma.changeproposals.claimApplyLease(
      proposalId,
      `held-${proposalId}`,
      at,
    );

  const statusesOf = (proposal: ChangeProposalDocument) =>
    proposal.operations.map((op) => [op.status, op.reason ?? null]);

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    applier = kit.newApplier({
      handlers: kit.buildHandlers(async () => {}).table,
    });
    service = createChangeProposalService(crowi, { applier });
  });

  beforeEach(async () => {
    // Each finder scans the whole collection, so counts are exact only when this
    // worker's DB holds nothing but this test's proposals.
    await prisma.changeproposals.deleteMany({});
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.tearDown();
  });

  describe('expireDueProposals', () => {
    it('expires an overdue open proposal and skips its pending operations', async () => {
      const page = await kit.createPage('expire-mixed');
      const second = await kit.createPage('expire-mixed-2');
      const proposal = await store(
        [kit.editInput(page), kit.editInput(second)],
        { expiresAt: future },
      );
      await service.approve(
        proposal._id,
        users.requester,
        [proposal.operations[0].key],
        BACKGROUND,
      );

      expect(
        await service.expireDueProposals(new Date(future.getTime() + 1000)),
      ).toBe(1);

      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('expired');
      expect(statusesOf(stored)).toEqual([
        ['applied', null],
        ['skipped', 'expired'],
      ]);
      expect(stored.operations[1].approvedAt).toBeUndefined();
    });

    it('leaves a proposal that is not yet due or has no expiry', async () => {
      const notDue = await storeEdit('expire-not-due', { expiresAt: future });
      const noExpiry = await storeEdit('expire-none');

      expect(await service.expireDueProposals(now)).toBe(0);

      expect((await kit.reload(notDue._id)).lifecycle).toBe('open');
      expect((await kit.reload(noExpiry._id)).lifecycle).toBe('open');
    });

    it('does not expire a proposal another process is applying', async () => {
      const proposal = await storeEdit('expire-leased', { expiresAt: past });
      await holdLease(proposal._id, now);

      expect(await service.expireDueProposals(now)).toBe(0);
      expect((await kit.reload(proposal._id)).lifecycle).toBe('open');
    });

    it('settles, instead of expiring, an overdue open proposal with nothing pending', async () => {
      const proposal = await storeStalled('expire-stalled', {
        expiresAt: past,
      });

      expect(await service.expireDueProposals(now)).toBe(0);
      expect((await kit.reload(proposal._id)).lifecycle).toBe('open');

      expect(await service.settleStalledProposals()).toBe(1);
      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('settled');
      expect(statusesOf(stored)).toEqual([['failed', 'write-error']]);
    });

    it('works through more due proposals than one batch holds', async () => {
      const batched = createChangeProposalService(crowi, {
        applier,
        maintenanceBatchSize: 2,
      });
      const page = await kit.createPage('expire-batches');
      const proposals = await Promise.all(
        Array.from({ length: 5 }, () =>
          store([kit.editInput(page)], { expiresAt: past }),
        ),
      );

      expect(await batched.expireDueProposals(now)).toBe(5);

      const stored = await Promise.all(proposals.map((p) => kit.reload(p._id)));
      expect(stored.map((p) => p.lifecycle)).toEqual(Array(5).fill('expired'));
    });

    it('expires a proposal created under the default expiry once 30 days have passed', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const thirtyDaysLater = new Date(
        createdAt.getTime() + 30 * 24 * AN_HOUR_MS,
      );
      const fixedClock = createChangeProposalService(crowi, {
        applier,
        now: () => createdAt,
      });
      const created = await fixedClock.createProposal({
        requester: users.requester,
        entry: 'ai-chat',
        operations: [
          { type: 'create', path: kit.nextPath('expire-default'), body: 'x' },
        ],
      });
      if (!created.ok) throw new Error('not created');

      await service.expireDueProposals(new Date(thirtyDaysLater.getTime() - 1));
      expect((await kit.reload(created.value.proposalId)).lifecycle).toBe(
        'open',
      );

      await service.expireDueProposals(thirtyDaysLater);
      expect((await kit.reload(created.value.proposalId)).lifecycle).toBe(
        'expired',
      );
    });

    it(
      'closes each proposal once when two servers expire at the same time',
      async () => {
        const other = createChangeProposalService(crowi, { applier });
        const page = await kit.createPage('expire-race');
        for (let round = 0; round < REPEAT; round++) {
          // biome-ignore lint/performance/noAwaitInLoops: rounds are independent repetitions of one race
          await prisma.changeproposals.deleteMany({});
          await Promise.all(
            Array.from({ length: 3 }, () =>
              store([kit.editInput(page)], { expiresAt: past }),
            ),
          );

          const counts = await Promise.all([
            service.expireDueProposals(now),
            other.expireDueProposals(now),
          ]);

          expect(counts[0] + counts[1]).toBe(3);
        }
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'never both applies and expires when the requester approves at the same moment',
      async () => {
        for (let round = 0; round < REPEAT / 2; round++) {
          // biome-ignore lint/performance/noAwaitInLoops: rounds are independent repetitions of one race
          const proposal = await storeEdit(`approve-race-${round}`, {
            expiresAt: past,
          });

          const [approved, expired] = await Promise.all([
            service.approve(proposal._id, users.requester, 'all', BACKGROUND),
            service.expireDueProposals(now),
          ]);

          const stored = await kit.reload(proposal._id);
          const [op] = stored.operations;
          const revisions = await kit.markedRevisions(proposal._id, op.key);
          if (stored.lifecycle === 'settled') {
            expect(op.status).toBe('applied');
            expect(revisions).toHaveLength(1);
            expect(expired).toBe(0);
          } else {
            expect(stored.lifecycle).toBe('expired');
            expect([op.status, op.reason]).toEqual(['skipped', 'expired']);
            expect(revisions).toHaveLength(0);
            expect(expired).toBe(1);
            expect(approved.ok ? 'approved' : approved.error.code).toMatch(
              /^(approved|not-open)$/,
            );
          }
        }
      },
      RACE_TIMEOUT_MS,
    );
  });

  describe('withdrawAllPending', () => {
    it('withdraws open proposals with pending operations but never a revert proposal', async () => {
      const waiting = await storeEdit('withdraw-waiting', {
        expiresAt: future,
      });
      const revert = await storeEdit('withdraw-revert', { entry: 'revert' });
      const stalled = await storeStalled('withdraw-stalled');

      expect(await service.withdrawAllPending()).toBe(1);

      const stored = await kit.reload(waiting._id);
      expect(stored.lifecycle).toBe('withdrawn');
      expect(statusesOf(stored)).toEqual([['skipped', 'withdrawn']]);
      expect((await kit.reload(revert._id)).lifecycle).toBe('open');
      expect((await kit.reload(stalled._id)).lifecycle).toBe('open');
    });

    it('does not withdraw a proposal another process is applying', async () => {
      const proposal = await storeEdit('withdraw-leased');
      await holdLease(proposal._id, new Date());

      expect(await service.withdrawAllPending()).toBe(0);
      expect((await kit.reload(proposal._id)).lifecycle).toBe('open');
    });
  });

  describe('resumeInterruptedApplies', () => {
    it('applies approved operations left without a lease and settles the proposal (Japanese path and body)', async () => {
      const page = await kit.createPage('日本語　ページ（再開）');
      const body = '# 見出し\n本文（全角）と絵文字 🎉\r\n';
      const proposal = await kit.storeProposal([kit.editInput(page, body)], {
        approve: true,
      });

      expect(await service.resumeInterruptedApplies(now)).toBe(1);

      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('settled');
      expect(statusesOf(stored)).toEqual([['applied', null]]);
      const [revision] = await kit.markedRevisions(
        proposal._id,
        stored.operations[0].key,
      );
      expect(revision.body.replace(/\r\n/g, '\n')).toBe(
        body.replace(/\r\n/g, '\n'),
      );
    });

    it('takes over a proposal whose lease has expired but not one whose lease is live', async () => {
      const expiredLease = await kit.storeProposal(
        [kit.editInput(await kit.createPage('resume-expired-lease'))],
        { approve: true },
      );
      await holdLease(expiredLease._id, new Date(now.getTime() - AN_HOUR_MS));
      const liveLease = await kit.storeProposal(
        [kit.editInput(await kit.createPage('resume-live-lease'))],
        { approve: true },
      );
      await holdLease(liveLease._id, now);

      expect(await service.resumeInterruptedApplies(now)).toBe(1);

      expect(statusesOf(await kit.reload(expiredLease._id))).toEqual([
        ['applied', null],
      ]);
      expect(statusesOf(await kit.reload(liveLease._id))).toEqual([
        ['pending', null],
      ]);
    });

    it('leaves operations nobody approved', async () => {
      const proposal = await storeEdit('resume-unapproved');

      expect(await service.resumeInterruptedApplies(now)).toBe(0);
      expect(statusesOf(await kit.reload(proposal._id))).toEqual([
        ['pending', null],
      ]);
    });

    it('keeps resuming the other proposals when one of them throws', async () => {
      const broken = await kit.storeProposal(
        [kit.editInput(await kit.createPage('resume-broken'))],
        { approve: true },
      );
      const healthy = await kit.storeProposal(
        [kit.editInput(await kit.createPage('resume-healthy'))],
        { approve: true },
      );
      let brokenAttempts = 0;
      const flaky = createChangeProposalService(crowi, {
        applier: {
          apply: (id, trigger, request) => {
            if (id !== broken._id) {
              return applier.apply(id, trigger, request);
            }
            brokenAttempts += 1;
            return Promise.reject(new Error('database went away'));
          },
        },
        maintenanceBatchSize: 1,
      });

      expect(await flaky.resumeInterruptedApplies(now)).toBe(1);
      // It still matches every batch read, yet is tried only once in a run.
      expect(brokenAttempts).toBe(1);

      expect(statusesOf(await kit.reload(healthy._id))).toEqual([
        ['applied', null],
      ]);
      expect(statusesOf(await kit.reload(broken._id))).toEqual([
        ['pending', null],
      ]);
    });

    it('does not retry, in the same run, an operation an open editor sent back to waiting', async () => {
      const page = await kit.createPage('resume-being-edited');
      const proposal = await kit.storeProposal([kit.editInput(page)], {
        approve: true,
      });
      kit.editingPageIds.add(page._id.toString());
      const apply = vi.fn(applier.apply);
      const counting = createChangeProposalService(crowi, {
        applier: { apply },
      });

      try {
        await counting.resumeInterruptedApplies(now);
      } finally {
        kit.editingPageIds.delete(page._id.toString());
      }

      expect(apply).toHaveBeenCalledTimes(1);
      expect(statusesOf(await kit.reload(proposal._id))).toEqual([
        ['pending', 'page-being-edited'],
      ]);
    });
  });

  describe('settleStalledProposals', () => {
    it('settles only open proposals with nothing pending', async () => {
      const stalled = await storeStalled('settle-stalled');
      const waiting = await storeEdit('settle-waiting');

      expect(await service.settleStalledProposals()).toBe(1);

      expect((await kit.reload(stalled._id)).lifecycle).toBe('settled');
      expect((await kit.reload(waiting._id)).lifecycle).toBe('open');
    });
  });
});
