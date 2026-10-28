import type { IUserHasId } from '@growi/core';
import { getIdStringForRef, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { CreatableOperationInput } from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { CreateProposalRequest } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';
import { updateChangeProposalSettings } from './settings';

const TEST_IP = '10.0.0.151';
const PREFIX = '/cp-service-create-integ';
const READ_ONLY_USERNAME = 'cpServiceCreateReadOnly';
const CAPPED_USERNAME = 'cpServiceCreateCapped';

describe('ChangeProposalService.createProposal: checks before saving', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let fixedClockService: ChangeProposalService;
  let readOnlyUser: HydratedDocument<IUserHasId>;
  let cappedUser: HydratedDocument<IUserHasId>;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceCreateRequester',
      subscriber: 'cpServiceCreateSubscriber',
      other: 'cpServiceCreateOther',
    },
  });
  const { users } = kit;
  const now = new Date('2026-10-27T03:00:00.000Z');

  const countProposalsOf = (user: IUserHasId) =>
    prisma.changeproposals.count({
      where: { requester: user._id.toString() },
    });

  const create = (overrides: Partial<CreateProposalRequest> = {}) =>
    service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [{ type: 'create', path: kit.nextPath('new'), body: 'x' }],
      request: { ip: TEST_IP },
      ...overrides,
    });

  const editOf = (
    page: Parameters<typeof kit.editInput>[0],
  ): Extract<CreatableOperationInput, { type: 'edit' }> => {
    const op = kit.editInput(page);
    if (op.type !== 'edit') throw new Error('not an edit');
    return op;
  };

  // Shapes an LLM tool call could send despite the static type.
  const untyped = <T>(value: unknown): T => value as T;

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    const User = mongoose.model<IUserHasId>('User');
    readOnlyUser = await User.create({
      name: READ_ONLY_USERNAME,
      username: READ_ONLY_USERNAME,
      email: `${READ_ONLY_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      readOnly: true,
    });
    cappedUser = await User.create({
      name: CAPPED_USERNAME,
      username: CAPPED_USERNAME,
      email: `${CAPPED_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    fixedClockService = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
      now: () => now,
    });
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    await configManager.updateConfigs(
      {
        'changeProposal:maxProposalsPerUserPerDay': undefined,
        'changeProposal:maxOperationsPerProposal': undefined,
        'changeProposal:pendingExpirationSeconds': undefined,
        'changeProposal:isEditEnabled': undefined,
      },
      { removeIfUndefined: true },
    );
    await configManager.updateConfigs({ 'app:changeProposalEnabled': true });
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: {
        requester: {
          in: [users.requester, readOnlyUser, cappedUser].map((u) =>
            u._id.toString(),
          ),
        },
      },
    });
    await mongoose.model('User').deleteMany({
      username: { $in: [READ_ONLY_USERNAME, CAPPED_USERNAME] },
    });
    await kit.tearDown();
  });

  describe('who may create', () => {
    it('rejects a guest and a read-only user without saving', async () => {
      const before = await countProposalsOf(readOnlyUser);

      await expect(create({ requester: null })).resolves.toEqual({
        ok: false,
        error: { code: 'user-not-allowed' },
      });
      await expect(create({ requester: readOnlyUser })).resolves.toEqual({
        ok: false,
        error: { code: 'user-not-allowed' },
      });
      expect(await countProposalsOf(readOnlyUser)).toBe(before);
    });
  });

  describe('switches and limits', () => {
    it('rejects when the write feature is disabled', async () => {
      await configManager.updateConfigs({ 'app:changeProposalEnabled': false });
      const before = await countProposalsOf(users.requester);

      await expect(create()).resolves.toEqual({
        ok: false,
        error: { code: 'feature-disabled' },
      });
      expect(await countProposalsOf(users.requester)).toBe(before);
    });

    it('rejects an operation whose type is disabled, pointing at it', async () => {
      await configManager.updateConfigs({
        'changeProposal:isEditEnabled': false,
      });
      const page = await kit.createPage('type-disabled');

      await expect(
        create({
          operations: [
            { type: 'create', path: kit.nextPath('ok'), body: 'x' },
            editOf(page),
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'operation-type-disabled', index: 1 },
        },
      });
    });

    it('rejects more operations than the configured maximum', async () => {
      await configManager.updateConfigs({
        'changeProposal:maxOperationsPerProposal': 2,
      });

      await expect(
        create({
          operations: [1, 2, 3].map((n) => ({
            type: 'create' as const,
            path: kit.nextPath(`many-${n}`),
            body: 'x',
          })),
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'too-many-operations', max: 2 },
        },
      });
    });

    describe('with the initial limits', () => {
      const createOperations = (count: number, label: string) =>
        Array.from({ length: count }, (_, n) => ({
          type: 'create' as const,
          path: kit.nextPath(`${label}-${n}`),
          body: 'x',
        }));

      it('rejects 51 operations and accepts 50', async () => {
        await expect(
          create({ operations: createOperations(51, 'default-51') }),
        ).resolves.toEqual({
          ok: false,
          error: {
            code: 'input-rejected',
            rejection: { code: 'too-many-operations', max: 50 },
          },
        });

        const result = await create({
          operations: createOperations(50, 'default-50'),
        });
        expect(result.ok).toBe(true);
      });

      it('never refuses for the number of proposals created in one day', async () => {
        for (let n = 0; n < 5; n++) {
          // biome-ignore lint/performance/noAwaitInLoops: each proposal must exist before the next is counted
          const result = await create();
          expect(result.ok).toBe(true);
        }
      });

      it('accepts 51 operations once an admin clears the operation cap', async () => {
        await updateChangeProposalSettings({
          maxOperationsPerProposal: null,
        });

        const result = await create({
          operations: createOperations(51, 'cleared-51'),
        });
        expect(result.ok).toBe(true);
      });
    });

    it('caps the proposals a user creates per day, not counting revert proposals', async () => {
      await configManager.updateConfigs({
        'changeProposal:maxProposalsPerUserPerDay': 2,
      });
      // A day ago is always before today's server-local midnight.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.changeproposals.create({
        data: {
          requester: cappedUser._id.toString(),
          entry: 'ai-chat',
          lifecycle: 'settled',
          operations: [],
          appliedPageIds: [],
          perPageNotifications: true,
          createdAt: yesterday,
        },
      });
      // Revert proposals are not counted.
      await prisma.changeproposals.createProposal({
        requester: cappedUser._id.toString(),
        entry: 'revert',
        perPageNotifications: true,
        operations: [],
      });

      const first = await create({ requester: cappedUser });
      const second = await create({ requester: cappedUser });
      const third = await create({ requester: cappedUser });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(third).toEqual({
        ok: false,
        error: { code: 'daily-limit-reached', max: 2 },
      });
    });

    it('does not check the daily count while no limit is configured', async () => {
      const results = await Promise.all([1, 2, 3].map(() => create()));

      expect(results.every((r) => r.ok)).toBe(true);
    });
  });

  describe('input shape at the entrance', () => {
    it('rejects the revert entry kind', async () => {
      await expect(
        create({ entry: untyped<CreateProposalRequest['entry']>('revert') }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'input-rejected', rejection: { code: 'invalid-entry' } },
      });
    });

    it('rejects a body that is not a string instead of throwing', async () => {
      await expect(
        create({
          operations: [
            { type: 'create', path: kit.nextPath('ok'), body: 'x' },
            untyped<CreatableOperationInput>({
              type: 'create',
              path: kit.nextPath('bad'),
              body: 42,
            }),
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'invalid-operation', index: 1 },
        },
      });
    });

    it('accepts a model label of 100 code points (emoji count once) and stores it as is', async () => {
      // 98 Japanese characters + 2 emoji: 102 UTF-16 units, 100 code points.
      const exact = `${'あ'.repeat(98)}🤖🧪`;
      expect(Array.from(exact)).toHaveLength(100);
      expect(exact.length).toBe(102);

      const result = await create({ modelLabel: exact });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stored = await kit.reload(result.value.proposalId);
      expect(stored.modelLabel).toBe(exact);
    });

    it('rejects a model label of 101 code points without truncating or saving', async () => {
      const label = `${'あ'.repeat(99)}🤖🧪`;
      expect(Array.from(label)).toHaveLength(101);
      const before = await countProposalsOf(users.requester);

      await expect(create({ modelLabel: label })).resolves.toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'model-label-too-long', max: 100 },
        },
      });
      expect(await countProposalsOf(users.requester)).toBe(before);
    });
  });

  describe('targets', () => {
    it('answers a page the requester cannot view exactly like a missing page', async () => {
      const hidden = await crowi.pageService.create(
        kit.nextPath('hidden'),
        'secret',
        users.other,
        { grant: PageGrant.GRANT_OWNER },
      );
      if (hidden.revision == null) throw new Error('no revision');
      const hiddenEdit: CreatableOperationInput = {
        type: 'edit',
        pageId: hidden._id.toString(),
        baseRevisionId: getIdStringForRef(hidden.revision),
        body: 'x',
      };
      const missingEdit: CreatableOperationInput = {
        ...hiddenEdit,
        pageId: new mongoose.Types.ObjectId().toString(),
      };
      const malformedEdit: CreatableOperationInput = {
        ...hiddenEdit,
        pageId: 'not-an-object-id',
      };
      const leading = {
        type: 'create' as const,
        path: kit.nextPath('ok'),
        body: 'x',
      };
      const before = await countProposalsOf(users.requester);

      const results = await Promise.all(
        [hiddenEdit, missingEdit, malformedEdit].map((op) =>
          create({ operations: [leading, op] }),
        ),
      );

      for (const result of results) {
        expect(result).toEqual({
          ok: false,
          error: { code: 'target-unavailable', index: 1 },
        });
      }
      expect(await countProposalsOf(users.requester)).toBe(before);
    });

    it('rejects a create path or move destination ending in a slash without saving, even next to an existing page', async () => {
      const existing = await kit.createPage('trailing-dup');
      const movable = await kit.createPage('trailing-move');
      const before = await countProposalsOf(users.requester);

      await expect(
        create({
          operations: [
            { type: 'create', path: `${existing.path}/`, body: 'x' },
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'invalid-path', index: 0 },
        },
      });
      await expect(
        create({
          operations: [
            { type: 'create', path: kit.nextPath('ok'), body: 'x' },
            {
              type: 'move',
              pageId: movable._id.toString(),
              fromPath: movable.path,
              toPath: `${kit.nextPath('移動先')}/`,
            },
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'input-rejected',
          rejection: { code: 'invalid-path', index: 1 },
        },
      });
      expect(await countProposalsOf(users.requester)).toBe(before);
    });

    it('rejects a move whose source page is not at the given path any more', async () => {
      const page = await kit.createPage('move-src');

      await expect(
        create({
          operations: [
            {
              type: 'move',
              pageId: page._id.toString(),
              fromPath: `${page.path}-elsewhere`,
              toPath: kit.nextPath('move-dst'),
            },
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 0 },
      });
    });

    it('rejects a base revision that is not one of the target page', async () => {
      const page = await kit.createPage('base-target');
      const another = await kit.createPage('base-other');
      const edit = editOf(page);
      const foreign = {
        ...edit,
        baseRevisionId: editOf(another).baseRevisionId,
      };

      await expect(create({ operations: [foreign] })).resolves.toEqual({
        ok: false,
        error: { code: 'base-revision-mismatch', index: 0 },
      });
      await expect(
        create({
          operations: [
            {
              ...edit,
              baseRevisionId: new mongoose.Types.ObjectId().toString(),
            },
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'base-revision-mismatch', index: 0 },
      });
      await expect(
        create({ operations: [{ ...edit, baseRevisionId: 'garbage' }] }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'base-revision-mismatch', index: 0 },
      });
    });
  });

  describe('what is saved', () => {
    it('saves the operations in order as pending, each with a random key, under Japanese paths', async () => {
      const page = await kit.createPage('保存 対象（全角）');
      const createdPath = kit.nextPath('新しい　ページ');
      const movedTo = kit.nextPath('移動先 [正規表現] (a|b).');

      const result = await create({
        modelLabel: 'クロード',
        operations: [
          {
            type: 'move',
            pageId: page._id.toString(),
            fromPath: page.path,
            toPath: movedTo,
          },
          { type: 'create', path: createdPath, body: '本文\r\n😀' },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.apply).toBeNull();
      const stored = await kit.reload(result.value.proposalId);
      expect(stored).toMatchObject({
        requester: users.requester._id.toString(),
        entry: 'ai-chat',
        modelLabel: 'クロード',
        lifecycle: 'open',
      });
      expect(stored.operations).toMatchObject([
        { index: 0, type: 'move', toPath: movedTo, status: 'pending' },
        { index: 1, type: 'create', path: createdPath, status: 'pending' },
      ]);
      expect(stored.operations.every((op) => op.approvedAt == null)).toBe(true);
      const keys = stored.operations.map((op) => op.key);
      expect(new Set(keys).size).toBe(2);
      expect(keys.every((k) => /^[0-9a-f-]{36}$/.test(k))).toBe(true);
    });

    describe('the expiry it stores', () => {
      const createAtFixedClock = async (): Promise<Date | undefined> => {
        const created = await fixedClockService.createProposal({
          requester: users.requester,
          entry: 'ai-chat',
          operations: [
            { type: 'create', path: kit.nextPath('exp'), body: 'x' },
          ],
        });
        if (!created.ok) throw new Error('not created');
        return (await kit.reload(created.value.proposalId)).expiresAt;
      };

      it('is 30 days after creation when the expiration is not configured', async () => {
        await expect(createAtFixedClock()).resolves.toEqual(
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        );
      });

      it('follows the configured expiration', async () => {
        await configManager.updateConfigs({
          'changeProposal:pendingExpirationSeconds': 3600,
        });

        await expect(createAtFixedClock()).resolves.toEqual(
          new Date(now.getTime() + 3600 * 1000),
        );
      });

      it('is absent once the expiration is cleared to 0', async () => {
        await configManager.updateConfigs({
          'changeProposal:pendingExpirationSeconds': 0,
        });

        await expect(createAtFixedClock()).resolves.toBeUndefined();
      });
    });

    it('stores the per-page notification switch as given, and true when omitted', async () => {
      const omitted = await create();
      const off = await create({ perPageNotifications: false });
      const on = await create({ perPageNotifications: true });

      if (!omitted.ok || !off.ok || !on.ok) throw new Error('not created');
      expect(
        (await kit.reload(omitted.value.proposalId)).perPageNotifications,
      ).toBe(true);
      expect(
        (await kit.reload(off.value.proposalId)).perPageNotifications,
      ).toBe(false);
      expect((await kit.reload(on.value.proposalId)).perPageNotifications).toBe(
        true,
      );
    });
  });
});
