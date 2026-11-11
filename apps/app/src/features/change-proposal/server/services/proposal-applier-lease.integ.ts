import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { createOperationHandlers } from './operation-handlers';
import {
  createApplierTestKit,
  type HandlerOverrides,
} from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.147';
const TEST_ENDPOINT = '/_api/v3/cp-proposal-applier-lease-integ';
const REPEAT = 20;
const CONCURRENT_CALLS = 10;
// 20 sequential rounds of real writes outgrow the default 5 s test timeout.
const RACE_TIMEOUT_MS = 60_000;
const AN_HOUR_MS = 60 * 60 * 1000;

describe('ProposalApplier.apply lease handling', () => {
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
    markedRevisions,
    aggregatedNotifications,
    buildHandlers,
    newApplier,
    setUp,
    resetPerPageNotificationsSetting,
    tearDown,
  } = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: '/cp-proposal-applier-lease-integ',
    ip: TEST_IP,
    usernames: {
      requester: 'cpApplierLeaseRequester',
      subscriber: 'cpApplierLeaseSubscriber',
      other: 'cpApplierLeaseOther',
    },
  });

  const observedHandlers = (overrides: HandlerOverrides = {}) => {
    const sendPerPageNotifications = vi.fn(async () => {});
    return {
      ...buildHandlers(sendPerPageNotifications, overrides),
      sendPerPageNotifications,
    };
  };

  const request = { ip: TEST_IP, endpoint: TEST_ENDPOINT };

  const enablePerPageNotifications = () =>
    configManager.updateConfigs({
      'changeProposal:perPageNotificationsEnabled': true,
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
    await waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await resetPerPageNotificationsSetting();
  });

  afterAll(async () => {
    await tearDown();
  });

  it('reports in-progress and writes nothing while another run holds a live lease', async () => {
    const page = await createPage('leased');
    const proposal = await storeProposal([editInput(page)]);
    await prisma.changeproposals.claimApplyLease(
      proposal._id,
      'other-run',
      new Date(),
    );

    const result = await newApplier().apply(proposal._id, {
      kind: 'background',
    });

    expect(result).toEqual({ type: 'in-progress' });
    const after = await reload(proposal._id);
    expect(after.operations[0].status).toBe('pending');
    expect(after.applyLease?.token).toBe('other-run');
    expect(
      await markedRevisions(proposal._id, after.operations[0].key),
    ).toEqual([]);
  });

  it(
    `writes each operation once when ${CONCURRENT_CALLS} applies race (${REPEAT} rounds)`,
    async () => {
      for (let round = 0; round < REPEAT; round += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: rounds are sequential by design
        const page = await createPage(`race-${round}`);
        await subscribe(page);
        const proposal = await storeProposal([editInput(page)]);
        const key = proposal.operations[0].key;
        const applier = newApplier();

        const results = await Promise.all(
          Array.from({ length: CONCURRENT_CALLS }, () =>
            applier.apply(proposal._id, { kind: 'background' }),
          ),
        );

        const appliedReports = results.flatMap((r) =>
          r.type === 'done' ? r.results : [],
        );
        expect(appliedReports).toEqual([{ key, status: 'applied' }]);
        expect(results.filter((r) => r.type === 'done').length).toBeGreaterThan(
          0,
        );
        expect(await markedRevisions(proposal._id, key)).toHaveLength(1);
        const after = await reload(proposal._id);
        expect(after.operations[0].status).toBe('applied');
        expect(after.lifecycle).toBe('settled');
        expect(await aggregatedNotifications(proposal._id)).toHaveLength(1);
      }
    },
    RACE_TIMEOUT_MS,
  );

  it('resumes after an interrupted run without writing again or re-sending per-page notifications', async () => {
    await configManager.updateConfigs({
      'changeProposal:perPageNotificationsEnabled': true,
    });
    const page = await createPage('resumed');
    await subscribe(page);
    const proposal = await storeProposal([editInput(page)], {
      perPageNotifications: true,
    });
    const op = proposal.operations[0];
    const { table, real, sendPerPageNotifications } = observedHandlers();
    // The interrupted run wrote the page, then died before recording and with its lease held.
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.changeproposals.claimApplyLease(
      proposal._id,
      'dead-run',
      longAgo,
    );
    if (op.type !== 'edit') {
      throw new Error('expected an edit operation');
    }
    await real.edit.execute(op, {
      proposalId: proposal._id,
      operationKey: op.key,
      requester: users.requester,
      activityParameters: request,
      perPageNotifications: false,
    });

    const result = await newApplier({
      handlers: table,
    }).apply(proposal._id, { kind: 'background' }, request);

    expect(result).toEqual({
      type: 'done',
      results: [{ key: op.key, status: 'applied' }],
    });
    expect(await markedRevisions(proposal._id, op.key)).toHaveLength(1);
    const after = await reload(proposal._id);
    expect(after.operations[0].status).toBe('applied');
    expect(after.appliedPageIds).toEqual([page._id.toString()]);
    expect(after.lastAppliedAt).toBeInstanceOf(Date);
    expect(after.lifecycle).toBe('settled');
    expect(sendPerPageNotifications).not.toHaveBeenCalled();
    expect(await aggregatedNotifications(proposal._id)).toHaveLength(1);
  });

  it('stops without recording when its lease was taken over, and never writes with the stale token', async () => {
    const page = await createPage('taken-over');
    const proposal = await storeProposal([editInput(page)]);
    const key = proposal.operations[0].key;
    const real = createOperationHandlers(crowi);
    const { table } = observedHandlers({
      edit: {
        execute: async (op, ctx) => {
          // The lease expires mid-write and another run claims it.
          const later = new Date(Date.now() + 60 * 60 * 1000);
          await prisma.changeproposals.claimApplyLease(
            proposal._id,
            'successor',
            later,
          );
          return real.edit.execute(op, ctx);
        },
      },
    });

    const result = await newApplier({
      handlers: table,
    }).apply(proposal._id, { kind: 'background' });

    expect(result).toEqual({ type: 'done', results: [] });
    const after = await reload(proposal._id);
    expect(after.operations[0].status).toBe('pending');
    expect(after.applyLease?.token).toBe('successor');
    expect(after.lifecycle).toBe('open');
    // The written revision is picked up by the successor's findExistingResult.
    expect(await markedRevisions(proposal._id, key)).toHaveLength(1);
  });

  it('stops when extending the lease fails after a recorded operation, leaving the rest pending', async () => {
    await enablePerPageNotifications();
    const first = await createPage('extend-first');
    const second = await createPage('extend-second');
    const proposal = await storeProposal(
      [editInput(first), editInput(second)],
      { perPageNotifications: true },
    );
    const [firstKey, secondKey] = proposal.operations.map((op) => op.key);
    // Runs after the first result is recorded and before the lease is extended.
    const { table } = observedHandlers({
      edit: {
        sendPerPageNotifications: async () => {
          await prisma.changeproposals.claimApplyLease(
            proposal._id,
            'successor',
            new Date(Date.now() + AN_HOUR_MS),
          );
        },
      },
    });

    const result = await newApplier({
      handlers: table,
    }).apply(proposal._id, { kind: 'background' });

    expect(result).toEqual({
      type: 'done',
      results: [{ key: firstKey, status: 'applied' }],
    });
    expect(await markedRevisions(proposal._id, secondKey)).toEqual([]);
    const after = await reload(proposal._id);
    expect(operationOf(after, secondKey).status).toBe('pending');
    expect(after.lifecycle).toBe('open');
  });

  it('releases the lease when an exception escapes the run', async () => {
    await enablePerPageNotifications();
    const page = await createPage('escaping');
    const proposal = await storeProposal([editInput(page)], {
      perPageNotifications: true,
    });
    const { table } = observedHandlers({
      edit: {
        sendPerPageNotifications: () =>
          Promise.reject(new Error('notification blew up')),
      },
    });

    await expect(
      newApplier({ handlers: table }).apply(proposal._id, {
        kind: 'background',
      }),
    ).rejects.toThrow('notification blew up');

    expect((await reload(proposal._id)).applyLease ?? null).toBeNull();
  });
});
