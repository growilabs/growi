import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.154';
const PREFIX = '/cp-service-skip-discard-integ';
const BACKGROUND = { kind: 'background' } as const;
const NOT_FOUND = { ok: false, error: { code: 'not-found' } };
const NOT_OPEN = { ok: false, error: { code: 'not-open' } };
const DONE = { ok: true, value: undefined };

describe('ChangeProposalService: skip, discard and the per-page notification switch', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const sendPerPageNotifications = vi.fn(async () => {});
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceSkipDiscardRequester',
      subscriber: 'cpServiceSkipDiscardSubscriber',
      other: 'cpServiceSkipDiscardOther',
    },
  });
  const { users } = kit;

  const storeWaiting = (
    operations: readonly CreateOperationInput[],
    perPageNotifications = false,
  ) => kit.storeProposal(operations, { approve: false, perPageNotifications });

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

  const storeTwoEdits = async (label: string) => {
    const pageA = await kit.createPage(`${label}-a`);
    const pageB = await kit.createPage(`${label}-b`);
    return storeWaiting([kit.editInput(pageA), kit.editInput(pageB)]);
  };

  const storeSettled = async (label: string) => {
    const proposal = await storeWaiting([
      kit.editInput(await kit.createPage(label)),
    ]);
    await service.approve(proposal._id, users.requester, 'all', BACKGROUND);
    expect((await kit.reload(proposal._id)).lifecycle).toBe('settled');
    return proposal;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier({
        handlers: kit.buildHandlers(sendPerPageNotifications).table,
      }),
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    sendPerPageNotifications.mockClear();
    await kit.resetPerPageNotificationsSetting();
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await kit.tearDown();
  });

  describe('skip', () => {
    it('marks only the chosen pending operation as skipped by the requester', async () => {
      const proposal = await storeTwoEdits('skip-one');

      expect(
        await service.skip(proposal._id, users.requester, [keyOf(proposal, 0)]),
      ).toEqual(DONE);

      const stored = await kit.reload(proposal._id);
      expect(stored.operations.map((op) => [op.status, op.reason])).toEqual([
        ['skipped', 'skipped-by-requester'],
        ['pending', undefined],
      ]);
      expect(stored.lifecycle).toBe('open');
    });

    it('settles the proposal when the last pending operation is skipped', async () => {
      const proposal = await storeTwoEdits('skip-last');
      await service.approve(
        proposal._id,
        users.requester,
        [keyOf(proposal, 0)],
        BACKGROUND,
      );

      expect(
        await service.skip(proposal._id, users.requester, [keyOf(proposal, 1)]),
      ).toEqual(DONE);

      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('settled');
      expect(stored.operations.map((op) => op.status)).toEqual([
        'applied',
        'skipped',
      ]);
    });

    it('leaves an applied operation as it is', async () => {
      const proposal = await storeTwoEdits('skip-applied');
      const applied = keyOf(proposal, 0);
      await service.approve(
        proposal._id,
        users.requester,
        [applied],
        BACKGROUND,
      );

      expect(
        await service.skip(proposal._id, users.requester, [applied]),
      ).toEqual(DONE);

      expect(
        kit.operationOf(await kit.reload(proposal._id), applied).status,
      ).toBe('applied');
    });

    it('answers "not found" to a user other than the requester and skips nothing', async () => {
      const proposal = await storeTwoEdits('skip-other');

      expect(
        await service.skip(proposal._id, users.other, [keyOf(proposal, 0)]),
      ).toEqual(NOT_FOUND);
      expect(
        (await kit.reload(proposal._id)).operations.map((op) => op.status),
      ).toEqual(['pending', 'pending']);
    });

    it('refuses a settled proposal as "not open", and still answers "not found" to others', async () => {
      const proposal = await storeSettled('skip-settled');
      const key = keyOf(proposal, 0);

      expect(await service.skip(proposal._id, users.requester, [key])).toEqual(
        NOT_OPEN,
      );
      expect(await service.skip(proposal._id, users.other, [key])).toEqual(
        NOT_FOUND,
      );
    });
  });

  describe('discard', () => {
    it('closes the proposal as discarded and skips every pending operation', async () => {
      const proposal = await storeTwoEdits('discard');
      const applied = keyOf(proposal, 0);
      await service.approve(
        proposal._id,
        users.requester,
        [applied],
        BACKGROUND,
      );

      expect(await service.discard(proposal._id, users.requester)).toEqual(
        DONE,
      );

      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('discarded');
      expect(
        stored.operations.map((op) => [op.status, op.reason, op.approvedAt]),
      ).toEqual([
        ['applied', undefined, expect.any(Date)],
        ['skipped', 'discarded', undefined],
      ]);
    });

    it('settles, instead of discarding, an open proposal that has nothing pending', async () => {
      const proposal = await storeTwoEdits('discard-nothing-pending');
      // A skip whose settle write never happened leaves the proposal open.
      await prisma.changeproposals.skipPendingOperations(
        proposal._id,
        users.requester._id.toString(),
        'all-pending',
      );
      expect((await kit.reload(proposal._id)).lifecycle).toBe('open');

      expect(await service.discard(proposal._id, users.requester)).toEqual(
        NOT_OPEN,
      );

      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('settled');
      expect(stored.operations.map((op) => op.reason)).toEqual([
        'skipped-by-requester',
        'skipped-by-requester',
      ]);
    });

    it('answers "not found" to a user other than the requester and keeps the proposal open', async () => {
      const proposal = await storeTwoEdits('discard-other');

      expect(await service.discard(proposal._id, users.other)).toEqual(
        NOT_FOUND,
      );
      const stored = await kit.reload(proposal._id);
      expect(stored.lifecycle).toBe('open');
      expect(stored.operations.map((op) => op.status)).toEqual([
        'pending',
        'pending',
      ]);
    });

    it('refuses a settled proposal as "not open", and still answers "not found" to others', async () => {
      const proposal = await storeSettled('discard-settled');

      expect(await service.discard(proposal._id, users.requester)).toEqual(
        NOT_OPEN,
      );
      expect(await service.discard(proposal._id, users.other)).toEqual(
        NOT_FOUND,
      );
      expect((await kit.reload(proposal._id)).lifecycle).toBe('settled');
    });
  });

  describe('setPerPageNotifications', () => {
    const enablePerPageNotifications = (enabled: boolean) =>
      configManager.updateConfigs({
        'changeProposal:perPageNotificationsEnabled': enabled,
      });

    it("changes the requester's open proposal, and later applies use the new value", async () => {
      await enablePerPageNotifications(true);
      const proposal = await storeWaiting(
        [kit.editInput(await kit.createPage('per-page-off'))],
        true,
      );

      expect(
        await service.setPerPageNotifications(
          proposal._id,
          users.requester,
          false,
        ),
      ).toEqual(DONE);
      expect(
        await prisma.changeproposals.readPerPageNotifications(proposal._id),
      ).toBe(false);

      await service.approve(proposal._id, users.requester, 'all', BACKGROUND);
      expect(sendPerPageNotifications).not.toHaveBeenCalled();
    });

    it('turns per-page notifications on for operations applied after the change', async () => {
      await enablePerPageNotifications(true);
      const proposal = await storeWaiting(
        [kit.editInput(await kit.createPage('per-page-on'))],
        false,
      );

      await service.setPerPageNotifications(
        proposal._id,
        users.requester,
        true,
      );
      await service.approve(proposal._id, users.requester, 'all', BACKGROUND);

      expect(sendPerPageNotifications).toHaveBeenCalledTimes(1);
    });

    it('saves the value even while the admin setting is off', async () => {
      await enablePerPageNotifications(false);
      const proposal = await storeWaiting(
        [kit.editInput(await kit.createPage('per-page-admin-off'))],
        false,
      );

      expect(
        await service.setPerPageNotifications(
          proposal._id,
          users.requester,
          true,
        ),
      ).toEqual(DONE);
      expect(
        await prisma.changeproposals.readPerPageNotifications(proposal._id),
      ).toBe(true);
    });

    it('answers "not found" to a user other than the requester and changes nothing', async () => {
      const proposal = await storeWaiting(
        [kit.editInput(await kit.createPage('per-page-other'))],
        true,
      );

      expect(
        await service.setPerPageNotifications(proposal._id, users.other, false),
      ).toEqual(NOT_FOUND);
      expect(
        await prisma.changeproposals.readPerPageNotifications(proposal._id),
      ).toBe(true);
    });

    it('answers "not found" to a value that is not a boolean and changes nothing', async () => {
      // Untyped callers (a route body) can hand over anything.
      const fromUntypedCaller = (value: unknown): boolean => value as boolean;
      const proposal = await storeWaiting(
        [kit.editInput(await kit.createPage('per-page-not-boolean'))],
        true,
      );

      expect(
        await service.setPerPageNotifications(
          proposal._id,
          users.requester,
          fromUntypedCaller('yes'),
        ),
      ).toEqual(NOT_FOUND);
      expect(
        await prisma.changeproposals.readPerPageNotifications(proposal._id),
      ).toBe(true);
    });

    it('refuses a proposal that is not open as "not open" and changes nothing', async () => {
      const proposal = await storeSettled('per-page-settled');

      expect(
        await service.setPerPageNotifications(
          proposal._id,
          users.requester,
          true,
        ),
      ).toEqual(NOT_OPEN);
      expect(
        await prisma.changeproposals.readPerPageNotifications(proposal._id),
      ).toBe(false);
      expect(
        await service.setPerPageNotifications(proposal._id, users.other, true),
      ).toEqual(NOT_FOUND);
    });
  });
});
