import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  AutoApplyPolicy,
  ChangeProposalDocument,
  ReviewerInput,
  ReviewerRef,
} from '../../interfaces';
import { MAX_PURPOSE_LENGTH, MAX_REVIEWERS } from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { CreateProposalRequest } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.154';
const PREFIX = '/cp-service-create-reviewers-integ';
const GROUP_NAME = 'cpServiceCreateReviewersGroup';
const EXTERNAL_GROUP_NAME = 'cpServiceCreateReviewersExternalGroup';

describe('ChangeProposalService.createProposal: reviewers and purpose', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let groupId: string;
  let externalGroupId: string;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceCreateReviewersRequester',
      subscriber: 'cpServiceCreateReviewersSubscriber',
      other: 'cpServiceCreateReviewersOther',
    },
  });
  const { users } = kit;
  const now = new Date();
  const BACKGROUND = { kind: 'background' } as const;

  const idOf = (user: IUserHasId): string => user._id.toString();
  const userInput = (user: IUserHasId): ReviewerInput => ({
    kind: 'user',
    id: idOf(user),
  });
  const newObjectId = () => new mongoose.Types.ObjectId().toString();

  const countProposals = () =>
    prisma.changeproposals.count({
      where: { requester: idOf(users.requester) },
    });

  const create = (overrides: Partial<CreateProposalRequest> = {}) =>
    service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [{ type: 'create', path: kit.nextPath('new'), body: 'x' }],
      request: { ip: TEST_IP },
      ...overrides,
    });

  const createdOk = async (
    result: Awaited<ReturnType<ChangeProposalService['createProposal']>>,
  ) => {
    if (!result.ok) {
      throw new Error(`not created: ${JSON.stringify(result.error)}`);
    }
    return {
      ...result.value,
      stored: await kit.reload(result.value.proposalId),
    };
  };

  // What a reviewer stored by this creation looks like.
  const storedAt = (input: ReviewerInput) => ({
    ...input,
    addedBy: idOf(users.requester),
    addedAt: now,
  });

  const refOf = (input: ReviewerInput, removed = false): ReviewerRef => ({
    ...input,
    addedBy: idOf(users.requester),
    addedAt: new Date(now.getTime() - 60_000),
    ...(removed
      ? {
          removedBy: idOf(users.requester),
          removedAt: new Date(now.getTime() - 30_000),
        }
      : {}),
  });

  const setReviewersEnabled = (enabled: boolean) =>
    configManager.updateConfigs({
      'app:changeProposalReviewersEnabled': enabled,
    });

  const setPolicy = (policy: AutoApplyPolicy) =>
    configManager.updateConfigs({ 'changeProposal:autoApplyPolicy': policy });

  const statusesOf = (proposal: ChangeProposalDocument) =>
    proposal.operations.map((op) => [op.status, op.approvedAt ?? null]);

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    const group = await UserGroup.create({ name: GROUP_NAME });
    groupId = group._id.toString();
    const externalGroup = await ExternalUserGroup.create({
      name: EXTERNAL_GROUP_NAME,
      externalId: EXTERNAL_GROUP_NAME,
      provider: 'ldap',
    });
    externalGroupId = externalGroup._id.toString();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
      now: () => now,
    });
  });

  beforeEach(async () => {
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    await setReviewersEnabled(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      {
        'app:changeProposalReviewersEnabled': undefined,
        'changeProposal:autoApplyPolicy': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { requester: idOf(users.requester) },
    });
    await UserGroup.deleteMany({ name: GROUP_NAME });
    await ExternalUserGroup.deleteMany({ name: EXTERNAL_GROUP_NAME });
    await kit.tearDown();
  });

  describe('what is saved', () => {
    it('saves users, a user group, an external group and the requester as reviewers, with who added them and when (Req 15.1, 15.2, 15.3)', async () => {
      const reviewers: ReviewerInput[] = [
        userInput(users.other),
        userInput(users.subscriber),
        { kind: 'user-group', id: groupId },
        { kind: 'external-user-group', id: externalGroupId },
        userInput(users.requester),
      ];

      const { stored } = await createdOk(await create({ reviewers }));

      expect(stored.reviewers).toEqual(reviewers.map(storedAt));
    });

    it('saves the same user or group given twice only once (Req 15.6)', async () => {
      const { stored } = await createdOk(
        await create({
          reviewers: [
            userInput(users.other),
            { kind: 'user-group', id: groupId },
            userInput(users.other),
            { kind: 'user-group', id: groupId },
          ],
        }),
      );

      expect(stored.reviewers).toEqual([
        storedAt(userInput(users.other)),
        storedAt({ kind: 'user-group', id: groupId }),
      ]);
    });

    it('saves no reviewers when none are given, so the requester alone is the reviewer (Req 15.4, 22.1)', async () => {
      const { stored } = await createdOk(await create());

      expect(stored.reviewers).toEqual([]);
    });

    it('saves the purpose exactly as given, markup included (Req 15.8, 15.10)', async () => {
      const purpose = '<script>alert(1)</script> **太字** の目的\n2 行目 😀';

      const { stored } = await createdOk(await create({ purpose }));

      expect(stored.purpose).toBe(purpose);
    });

    it(`saves a purpose of ${MAX_PURPOSE_LENGTH} emoji, counted as code points (Req 15.9)`, async () => {
      const purpose = '😀'.repeat(MAX_PURPOSE_LENGTH);

      const { stored } = await createdOk(await create({ purpose }));

      expect(stored.purpose).toBe(purpose);
    });
  });

  describe('refusals, which save nothing', () => {
    it.each([
      ['a user', 'user'],
      ['a user group', 'user-group'],
      ['an external group', 'external-user-group'],
    ] as const)('refuses %s that does not exist (Req 15.5)', async (_label, kind) => {
      const before = await countProposals();

      const result = await create({
        reviewers: [userInput(users.other), { kind, id: newObjectId() }],
      });

      expect(result).toEqual({
        ok: false,
        error: { code: 'reviewer-not-found' },
      });
      expect(await countProposals()).toBe(before);
    });

    it.each([
      ['registered', UserStatus.STATUS_REGISTERED],
      ['suspended', UserStatus.STATUS_SUSPENDED],
      ['deleted', UserStatus.STATUS_DELETED],
      ['invited', UserStatus.STATUS_INVITED],
    ] as const)('refuses a %s user as a reviewer that does not exist (Req 15.5)', async (label, status) => {
      const username = `cpServiceCreateReviewersInactive-${label}`;
      const User = mongoose.model<IUserHasId>('User');
      const inactive = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status,
      });
      const before = await countProposals();

      try {
        expect(await create({ reviewers: [userInput(inactive)] })).toEqual({
          ok: false,
          error: { code: 'reviewer-not-found' },
        });
        expect(await countProposals()).toBe(before);
      } finally {
        await User.deleteMany({ _id: inactive._id });
      }
    });

    it('refuses an id that is not an object id as a reviewer that does not exist (Req 15.5)', async () => {
      const before = await countProposals();

      const result = await create({
        reviewers: [{ kind: 'user-group', id: 'not-an-object-id' }],
      });

      expect(result).toEqual({
        ok: false,
        error: { code: 'reviewer-not-found' },
      });
      expect(await countProposals()).toBe(before);
    });

    it(`refuses ${MAX_REVIEWERS + 1} reviewers (Req 15.7)`, async () => {
      const before = await countProposals();

      const result = await create({
        reviewers: Array.from({ length: MAX_REVIEWERS + 1 }, () => ({
          kind: 'user' as const,
          id: newObjectId(),
        })),
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'too-many-reviewers', max: MAX_REVIEWERS },
        },
      });
      expect(await countProposals()).toBe(before);
    });

    it(`refuses a purpose of ${MAX_PURPOSE_LENGTH + 1} code points (Req 15.9)`, async () => {
      const before = await countProposals();

      const result = await create({
        purpose: 'あ'.repeat(MAX_PURPOSE_LENGTH + 1),
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'purpose-too-long', max: MAX_PURPOSE_LENGTH },
        },
      });
      expect(await countProposals()).toBe(before);
    });
  });

  describe('while the reviewers switch is off', () => {
    beforeEach(() => setReviewersEnabled(false));

    it.each([
      ['another user', () => [userInput(users.other)]],
      ['a group', () => [{ kind: 'user-group' as const, id: groupId }]],
      [
        'the requester together with another user',
        () => [userInput(users.requester), userInput(users.other)],
      ],
    ])('refuses %s as a reviewer without saving', async (_label, reviewers) => {
      const before = await countProposals();

      const result = await create({ reviewers: reviewers() });

      expect(result).toEqual({
        ok: false,
        error: { code: 'reviewers-disabled' },
      });
      expect(await countProposals()).toBe(before);
    });

    it('accepts the requester alone as the reviewer, and no reviewers at all (Req 15.3, 22.1)', async () => {
      const own = await createdOk(
        await create({ reviewers: [userInput(users.requester)] }),
      );
      const none = await createdOk(await create());

      expect(own.stored.reviewers).toEqual([
        storedAt(userInput(users.requester)),
      ]);
      expect(none.stored.reviewers).toEqual([]);
    });
  });

  describe('auto-apply right after creation', () => {
    describe.each(['own-pages', 'all'] as const)('with policy %s', (policy) => {
      beforeEach(() => setPolicy(policy));

      it.each([
        ['another user', () => [userInput(users.other)]],
        ['a group', () => [{ kind: 'user-group' as const, id: groupId }]],
        [
          'the requester and another user',
          () => [userInput(users.requester), userInput(users.other)],
        ],
      ])('applies nothing and keeps every operation pending when %s is a reviewer (Req 15.11)', async (_label, reviewers) => {
        const { apply, stored } = await createdOk(
          await create({
            reviewers: reviewers(),
            operations: [
              { type: 'create', path: kit.nextPath('held-a'), body: 'a' },
              { type: 'create', path: kit.nextPath('held-b'), body: 'b' },
            ],
          }),
        );

        expect(apply).toBeNull();
        expect(statusesOf(stored)).toEqual([
          ['pending', null],
          ['pending', null],
        ]);
      });

      it('applies by the policy as before when the requester alone is the reviewer (Req 22.2)', async () => {
        const { apply, stored } = await createdOk(
          await create({ reviewers: [userInput(users.requester)] }),
        );

        expect(apply).toMatchObject({ type: 'done' });
        expect(stored.operations.map((op) => op.status)).toEqual(['applied']);
      });

      it('applies by the policy as before when no reviewers are given (Req 22.1, 22.2)', async () => {
        const { apply, stored } = await createdOk(await create());

        expect(apply).toMatchObject({ type: 'done' });
        expect(stored.operations.map((op) => op.status)).toEqual(['applied']);
      });
    });
  });

  describe('follow-up and rework', () => {
    // A settled base: the move failed (follow-up eligible), the edit was applied (rework eligible).
    const storeSettledBase = async (
      reviewers: readonly ReviewerRef[],
    ): Promise<{ failedKey: string; appliedKey: string; id: string }> => {
      const page = await kit.createPage('base-edit');
      const base = await kit.storeProposal(
        [
          {
            type: 'move',
            pageId: newObjectId(),
            fromPath: kit.nextPath('gone'),
            toPath: kit.nextPath('gone-dst'),
          },
          kit.editInput(page, 'base body'),
        ],
        { reviewers },
      );
      await kit.newApplier().apply(base._id, BACKGROUND);
      const settled = await kit.reload(base._id);
      const [move, edit] = settled.operations;
      if (move.status !== 'failed' || edit.status !== 'applied') {
        throw new Error('fixture broken');
      }
      return { failedKey: move.key, appliedKey: edit.key, id: base._id };
    };

    beforeEach(() => setPolicy('all'));

    it('inherits the active reviewers of the base, not the removed ones, and applies nothing (Req 22.4, 22.5)', async () => {
      const base = await storeSettledBase([
        refOf(userInput(users.other)),
        refOf({ kind: 'user-group', id: groupId }),
        refOf(userInput(users.subscriber), true),
      ]);

      const { apply, stored } = await createdOk(
        await create({
          basedOn: {
            proposalId: base.id,
            relation: 'follow-up',
            operationKeys: [base.failedKey],
          },
        }),
      );

      expect(stored.reviewers).toEqual([
        storedAt(userInput(users.other)),
        storedAt({ kind: 'user-group', id: groupId }),
      ]);
      expect(apply).toBeNull();
      expect(stored.operations.map((op) => op.status)).toEqual(['pending']);
    });

    it('inherits the reviewers even while the reviewers switch is off (Req 22.4)', async () => {
      const base = await storeSettledBase([refOf(userInput(users.other))]);
      await setReviewersEnabled(false);

      const { stored } = await createdOk(
        await create({
          basedOn: {
            proposalId: base.id,
            relation: 'rework',
            operationKeys: [base.appliedKey],
          },
        }),
      );

      expect(stored.reviewers).toEqual([storedAt(userInput(users.other))]);
    });

    it('takes the reviewers given at creation instead of the inherited ones, and auto-applies when only the requester is left (Req 22.4)', async () => {
      const base = await storeSettledBase([refOf(userInput(users.other))]);

      const { apply, stored } = await createdOk(
        await create({
          basedOn: {
            proposalId: base.id,
            relation: 'follow-up',
            operationKeys: [base.failedKey],
          },
          reviewers: [userInput(users.requester)],
        }),
      );

      expect(stored.reviewers).toEqual([storedAt(userInput(users.requester))]);
      expect(apply).toMatchObject({ type: 'done' });
      expect(stored.operations.map((op) => op.status)).toEqual(['applied']);
    });

    it('drops the inherited reviewers when an empty list is given at creation (Req 22.4)', async () => {
      const base = await storeSettledBase([refOf(userInput(users.other))]);

      const { stored } = await createdOk(
        await create({
          basedOn: {
            proposalId: base.id,
            relation: 'follow-up',
            operationKeys: [base.failedKey],
          },
          reviewers: [],
        }),
      );

      expect(stored.reviewers).toEqual([]);
      expect(stored.operations.map((op) => op.status)).toEqual(['applied']);
    });

    it('derives from a base stored before reviewers existed as before: no reviewers, applied by the policy (Req 22.1)', async () => {
      const base = await storeSettledBase([]);
      await mongoose.connection
        .collection('changeproposals')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(base.id) },
          { $unset: { reviewers: '', reviews: '', purpose: '' } },
        );

      const { apply, stored } = await createdOk(
        await create({
          basedOn: {
            proposalId: base.id,
            relation: 'follow-up',
            operationKeys: [base.failedKey],
          },
        }),
      );

      expect(stored.reviewers).toEqual([]);
      expect(apply).toMatchObject({ type: 'done' });
      expect(stored.operations.map((op) => op.status)).toEqual(['applied']);
    });
  });

  it('creates and applies a revert proposal of a proposal with reviewers as before, with no reviewers of its own (Req 22.6)', async () => {
    const page = await kit.createPage('revert-edit');
    const original = await kit.storeProposal(
      [kit.editInput(page, 'proposed body')],
      { reviewers: [refOf(userInput(users.other))] },
    );
    await kit.newApplier().apply(original._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();

    const result = await service.revert(
      original._id,
      users.requester,
      'all-visible',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();

    if (!result.ok || result.value.revertProposalId == null) {
      throw new Error(`not reverted: ${JSON.stringify(result)}`);
    }
    const revertProposal = await kit.reload(result.value.revertProposalId);
    expect(revertProposal.reviewers).toEqual([]);
    expect(revertProposal.operations.map((op) => op.status)).toEqual([
      'applied',
    ]);
  });
});
