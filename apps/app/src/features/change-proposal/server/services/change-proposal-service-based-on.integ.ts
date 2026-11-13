import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { BasedOn, ChangeProposalDocument } from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { CreateProposalRequest } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.153';
const PREFIX = '/cp-service-based-on-integ';

describe('ChangeProposalService.createProposal: follow-up and rework', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceBasedOnRequester',
      subscriber: 'cpServiceBasedOnSubscriber',
      other: 'cpServiceBasedOnOther',
    },
  });
  const { users } = kit;

  const createBasedOn = (
    basedOn: BasedOn,
    overrides: Partial<CreateProposalRequest> = {},
  ) =>
    service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [
        { type: 'create', path: kit.nextPath('derived'), body: 'x' },
      ],
      request: { ip: TEST_IP },
      basedOn,
      ...overrides,
    });

  // A base whose first operation failed (follow-up eligible) and second was applied (rework eligible).
  const storeSettledBase = async (
    options: {
      requester?: string;
      entry?: ChangeProposalDocument['entry'];
    } = {},
  ): Promise<ChangeProposalDocument> => {
    const page = await kit.createPage('base-edit');
    const base = await kit.storeProposal(
      [
        {
          type: 'move',
          pageId: new mongoose.Types.ObjectId().toString(),
          fromPath: kit.nextPath('gone'),
          toPath: kit.nextPath('gone-dst'),
        },
        kit.editInput(page, '元の提案の本文'),
      ],
      options,
    );
    await kit.newApplier().apply(base._id, { kind: 'background' });
    return kit.reload(base._id);
  };

  const keysOf = (proposal: ChangeProposalDocument) => {
    const edit = proposal.operations.find((op) => op.type === 'edit');
    const move = proposal.operations.find((op) => op.type === 'move');
    if (edit == null || move == null) throw new Error('fixture broken');
    return { appliedKey: edit.key, failedKey: move.key };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    await configManager.updateConfigs({
      'changeProposal:autoApplyPolicy': 'all',
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(() => {
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  });

  it('fixture: the base is settled with one failed and one applied operation', async () => {
    const base = await storeSettledBase();

    expect(base.lifecycle).toBe('settled');
    expect(base.operations.map((op) => [op.type, op.status])).toEqual([
      ['move', 'failed'],
      ['edit', 'applied'],
    ]);
  });

  it('saves a follow-up of a settled proposal, applies it by the policy, and leaves the base untouched', async () => {
    const base = await storeSettledBase();
    const { failedKey } = keysOf(base);

    const result = await createBasedOn(
      {
        proposalId: base._id,
        relation: 'follow-up',
        operationKeys: [failedKey, failedKey],
      },
      { perPageNotifications: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const derived = await kit.reload(result.value.proposalId);
    expect(derived.basedOn).toEqual({
      proposalId: base._id,
      relation: 'follow-up',
      operationKeys: [failedKey],
    });
    expect(derived.perPageNotifications).toBe(false);
    expect(derived.operations.map((op) => op.status)).toEqual(['applied']);
    expect(derived.lifecycle).toBe('settled');
    const baseAfter = await kit.reload(base._id);
    expect(baseAfter.operations).toEqual(base.operations);
    expect(baseAfter.lifecycle).toBe('settled');
  });

  it('keeps a rework waiting for approval even under the "all" policy', async () => {
    const base = await storeSettledBase();
    const { appliedKey } = keysOf(base);

    const result = await createBasedOn({
      proposalId: base._id,
      relation: 'rework',
      operationKeys: [appliedKey],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.apply).toBeNull();
    const derived = await kit.reload(result.value.proposalId);
    expect(derived.perPageNotifications).toBe(true);
    expect(derived.lifecycle).toBe('open');
    expect(derived.operations.map((op) => [op.status, op.approvedAt])).toEqual([
      ['pending', undefined],
    ]);
    expect((await kit.reload(base._id)).operations).toEqual(base.operations);
  });

  it("answers another user's proposal, an unknown id and a revert proposal the same way, without saving", async () => {
    const othersBase = await storeSettledBase({
      requester: users.other._id.toString(),
    });
    const revertBase = await storeSettledBase({ entry: 'revert' });
    const before = await prisma.changeproposals.count({
      where: { requester: users.requester._id.toString() },
    });

    const results = await Promise.all(
      [
        othersBase,
        revertBase,
        { ...othersBase, _id: new mongoose.Types.ObjectId().toString() },
        { ...othersBase, _id: 'not-an-object-id' },
      ].map((base) =>
        createBasedOn({
          proposalId: base._id,
          relation: 'follow-up',
          operationKeys: [keysOf(othersBase).failedKey],
        }),
      ),
    );

    for (const result of results) {
      expect(result).toEqual({
        ok: false,
        error: { code: 'based-on-unavailable' },
      });
    }
    expect(
      await prisma.changeproposals.count({
        where: { requester: users.requester._id.toString() },
      }),
    ).toBe(before);
  });

  it('names the first base operation whose state does not fit the relation', async () => {
    const base = await storeSettledBase();
    const { appliedKey, failedKey } = keysOf(base);

    await expect(
      createBasedOn({
        proposalId: base._id,
        relation: 'follow-up',
        operationKeys: [failedKey, appliedKey],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'based-on-operation-not-eligible',
        operationKey: appliedKey,
      },
    });
    await expect(
      createBasedOn({
        proposalId: base._id,
        relation: 'rework',
        operationKeys: ['no-such-key'],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'based-on-operation-not-eligible',
        operationKey: 'no-such-key',
      },
    });
    await expect(
      createBasedOn({
        proposalId: base._id,
        relation: 'rework',
        operationKeys: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'based-on-operation-not-eligible' },
    });
  });

  it('rejects an unknown relation as an unusable base instead of throwing', async () => {
    const base = await storeSettledBase();

    await expect(
      createBasedOn({
        proposalId: base._id,
        relation: 'redo' as BasedOn['relation'],
        operationKeys: [keysOf(base).failedKey],
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'based-on-unavailable' } });
  });

  it('checks the other requirements before reading the base', async () => {
    const base = await storeSettledBase();

    await expect(
      createBasedOn(
        {
          proposalId: base._id,
          relation: 'follow-up',
          operationKeys: [keysOf(base).failedKey],
        },
        {
          operations: [
            {
              type: 'edit',
              pageId: new mongoose.Types.ObjectId().toString(),
              baseRevisionId: new mongoose.Types.ObjectId().toString(),
              body: 'x',
            },
          ],
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'target-unavailable', index: 0 },
    });
  });
});
