import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import { createApplierTestKit } from './proposal-applier.test-kit';
import type { ProposalNotifier } from './proposal-notifier';

const TEST_IP = '10.0.0.191';
const TEST_ENDPOINT = '/_api/v3/cp-proposal-applier-report-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ProposalApplier.apply reporting when the run stops with an error', () => {
  let crowi: Crowi;
  const {
    users,
    waitForPageOperationsToFinish,
    createPage,
    subscribe,
    editInput,
    storeProposal,
    reload,
    operationOf,
    aggregatedNotifications,
    snapshotPagesOf,
    newApplier,
    setUp,
    tearDown,
  } = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: '/cp-proposal-applier-report-integ',
    ip: TEST_IP,
    usernames: {
      requester: 'cpApplierReportRequester',
      subscriber: 'cpApplierReportSubscriber',
      other: 'cpApplierReportOther',
    },
  });

  const request = { ip: TEST_IP, endpoint: TEST_ENDPOINT };

  const applyActivities = (proposalId: string) =>
    prisma.activities.findMany({
      where: {
        target: proposalId,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      },
    });

  const waitForActivities = (proposalId: string, count: number) =>
    vi.waitFor(
      async () => {
        const rows = await applyActivities(proposalId);
        expect(rows).toHaveLength(count);
        return rows;
      },
      { timeout: 3000, interval: 50 },
    );

  // Two subscribed pages, so the summary shows whether only the applied one is reported.
  const storeTwoEdits = async () => {
    const first = await createPage('first');
    const second = await createPage('second');
    await subscribe(first);
    await subscribe(second);
    const proposal = await storeProposal([editInput(first), editInput(second)]);
    return {
      proposal,
      first,
      firstKey: proposal.operations[0].key,
      secondKey: proposal.operations[1].key,
    };
  };

  const spyOnStore = () => ({
    record: prisma.changeproposals.recordOperationOutcome.bind(
      prisma.changeproposals,
    ),
    extend: prisma.changeproposals.extendApplyLease.bind(
      prisma.changeproposals,
    ),
    recordSpy: vi.spyOn(prisma.changeproposals, 'recordOperationOutcome'),
    extendSpy: vi.spyOn(prisma.changeproposals, 'extendApplyLease'),
  });
  // Restoring a spy on a Prisma extension method leaves the method undefined and a
  // spy's own call-through loses the extension context, so the spies stay installed
  // and call the bound originals. Created in beforeAll: the Prisma client must not be
  // touched before the test setup connects it.
  let store: ReturnType<typeof spyOnStore>;

  beforeAll(async () => {
    crowi = await getInstance();
    await setUp();
    store = spyOnStore();
  });

  beforeEach(() => {
    store.recordSpy.mockReset().mockImplementation(store.record);
    store.extendSpy.mockReset().mockImplementation(store.extend);
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await waitForPageOperationsToFinish();
  });

  afterAll(async () => {
    vi.mocked(crowi.pageService.pageEvent.emit).mockRestore();
    await tearDown();
  });

  it('still records the activity and the summary for the operation it applied when extending the lease throws, releases the lease and rethrows', async () => {
    const { proposal, first, firstKey, secondKey } = await storeTwoEdits();
    const dbError = new Error('lease extension failed');
    store.extendSpy.mockRejectedValueOnce(dbError);

    await expect(
      newApplier().apply(proposal._id, BACKGROUND, request),
    ).rejects.toBe(dbError);

    const after = await reload(proposal._id);
    expect(operationOf(after, firstKey).status).toBe('applied');
    expect(operationOf(after, secondKey).status).toBe('pending');
    expect(after.applyLease ?? null).toBeNull();
    const [activity] = await waitForActivities(proposal._id, 1);
    expect(activity).toMatchObject({
      userId: users.requester._id.toString(),
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });
    const notifications = await aggregatedNotifications(proposal._id);
    expect(notifications).toHaveLength(1);
    expect(snapshotPagesOf(notifications[0])).toEqual([first._id.toString()]);
    expect(notifications[0].activities.map(String)).toEqual([activity.id]);
  });

  it('still reports the operation it applied when recording the next outcome throws', async () => {
    const { proposal, first, firstKey, secondKey } = await storeTwoEdits();
    const dbError = new Error('outcome write failed');
    store.recordSpy
      .mockImplementationOnce(store.record)
      .mockRejectedValueOnce(dbError);

    await expect(newApplier().apply(proposal._id, BACKGROUND)).rejects.toBe(
      dbError,
    );

    const after = await reload(proposal._id);
    expect(operationOf(after, firstKey).status).toBe('applied');
    expect(operationOf(after, secondKey).status).toBe('pending');
    expect(after.applyLease ?? null).toBeNull();
    await waitForActivities(proposal._id, 1);
    const notifications = await aggregatedNotifications(proposal._id);
    expect(notifications).toHaveLength(1);
    expect(snapshotPagesOf(notifications[0])).toEqual([first._id.toString()]);
  });

  it('rethrows the original error, not the reporting one, when reporting also fails', async () => {
    const { proposal, firstKey } = await storeTwoEdits();
    const dbError = new Error('lease extension failed');
    store.extendSpy.mockRejectedValueOnce(dbError);
    const notifier = mock<ProposalNotifier>({
      notifyApplied: vi.fn().mockRejectedValue(new Error('notifier down')),
    });

    await expect(
      newApplier({ notifier }).apply(proposal._id, BACKGROUND),
    ).rejects.toBe(dbError);

    expect(notifier.notifyApplied).toHaveBeenCalledTimes(1);
    const after = await reload(proposal._id);
    expect(operationOf(after, firstKey).status).toBe('applied');
    expect(after.applyLease ?? null).toBeNull();
  });

  it('reports nothing and rethrows when the run throws before applying any operation', async () => {
    const { proposal, firstKey } = await storeTwoEdits();
    const dbError = new Error('outcome write failed');
    store.recordSpy.mockRejectedValueOnce(dbError);
    const notifier = mock<ProposalNotifier>();

    await expect(
      newApplier({ notifier }).apply(proposal._id, BACKGROUND),
    ).rejects.toBe(dbError);

    expect(notifier.notifyApplied).not.toHaveBeenCalled();
    expect(await applyActivities(proposal._id)).toEqual([]);
    expect(operationOf(await reload(proposal._id), firstKey).status).toBe(
      'pending',
    );
  });
});
