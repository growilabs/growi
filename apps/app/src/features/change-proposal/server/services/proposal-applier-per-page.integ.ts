import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { OperationRecord } from '../../interfaces';
import {
  createOperationHandlers,
  type OperationHandler,
} from './operation-handlers';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.149';

describe('ProposalApplier.apply deciding per-page notifications for each operation', () => {
  let crowi: Crowi;
  const {
    users,
    waitForPageOperationsToFinish,
    createPage,
    editInput,
    storeProposal,
    operationOf,
    buildHandlers,
    newApplier,
    setUp,
    resetPerPageNotificationsSetting,
    tearDown,
  } = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: '/cp-proposal-applier-per-page-integ',
    ip: TEST_IP,
    usernames: {
      requester: 'cpApplierPerPageRequester',
      subscriber: 'cpApplierPerPageSubscriber',
      other: 'cpApplierPerPageOther',
    },
  });

  const setPerPageNotificationsSetting = (enabled: boolean) =>
    configManager.updateConfigs({
      'changeProposal:perPageNotificationsEnabled': enabled,
    });

  const observeNotifications = () =>
    vi.fn<OperationHandler<OperationRecord>['sendPerPageNotifications']>(
      async () => {},
    );

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
    await configManager.updateConfigs({ 'app:changeProposalEnabled': true });
  });

  afterAll(async () => {
    await tearDown();
  });

  it('uses the proposal value saved between two operations only for the later operation', async () => {
    await setPerPageNotificationsSetting(true);
    const first = await createPage('first');
    const second = await createPage('second');
    const proposal = await storeProposal(
      [editInput(first), editInput(second)],
      { perPageNotifications: false },
    );
    const [firstKey, secondKey] = proposal.operations.map((op) => op.key);
    const sendPerPageNotifications = observeNotifications();
    const real = createOperationHandlers(crowi);
    const { table } = buildHandlers(sendPerPageNotifications, {
      edit: {
        execute: async (op, ctx) => {
          const outcome = await real.edit.execute(op, ctx);
          if (op.key === firstKey) {
            await prisma.changeproposals.setPerPageNotifications(
              proposal._id,
              users.requester._id.toString(),
              true,
            );
          }
          return outcome;
        },
      },
    });

    await newApplier({ handlers: table }).apply(proposal._id, {
      kind: 'background',
    });

    expect(sendPerPageNotifications.mock.calls.map(([op]) => op.key)).toEqual([
      secondKey,
    ]);
  });

  it('sends no per-page notifications while the admin setting is off even when the proposal asks for them', async () => {
    await setPerPageNotificationsSetting(false);
    const page = await createPage('admin-off');
    const proposal = await storeProposal([editInput(page)], {
      perPageNotifications: true,
    });
    const sendPerPageNotifications = observeNotifications();

    const result = await newApplier({
      handlers: buildHandlers(sendPerPageNotifications).table,
    }).apply(proposal._id, { kind: 'background' });

    expect(result).toMatchObject({
      type: 'done',
      results: [{ status: 'applied' }],
    });
    expect(sendPerPageNotifications).not.toHaveBeenCalled();
  });

  it.each([
    { adminSetting: true, proposalValue: true, expected: true },
    { adminSetting: false, proposalValue: true, expected: false },
    { adminSetting: true, proposalValue: false, expected: false },
  ])('applies a revert proposal with the feature off and decides its per-page notifications by admin=$adminSetting and proposal=$proposalValue', async ({
    adminSetting,
    proposalValue,
    expected,
  }) => {
    const page = await createPage('revert');
    const original = await storeProposal([editInput(page, 'proposed body')]);
    const [originalKey] = original.operations.map((op) => op.key);
    await newApplier().apply(original._id, { kind: 'background' });
    const appliedRevisionId = operationOf(
      (await prisma.changeproposals.findProposal(original._id)) ?? original,
      originalKey,
    ).resultRevisionId;
    if (appliedRevisionId == null) {
      throw new Error('the original edit was not applied');
    }
    const revert = await storeProposal(
      [
        {
          type: 'edit',
          pageId: page._id.toString(),
          baseRevisionId: appliedRevisionId,
          body: 'base body',
          revertTarget: { proposalId: original._id, operationKey: originalKey },
        },
      ],
      {
        entry: 'revert',
        revertOf: original._id,
        perPageNotifications: proposalValue,
      },
    );
    await configManager.updateConfigs({ 'app:changeProposalEnabled': false });
    await setPerPageNotificationsSetting(adminSetting);
    const sendPerPageNotifications = observeNotifications();

    const result = await newApplier({
      handlers: buildHandlers(sendPerPageNotifications).table,
    }).apply(revert._id, { kind: 'background' });

    expect(result).toMatchObject({
      type: 'done',
      results: [{ status: 'applied' }],
    });
    expect(sendPerPageNotifications).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
});
