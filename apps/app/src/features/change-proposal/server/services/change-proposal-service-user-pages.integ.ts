import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { CreatableOperationInput } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.157';
const PREFIX = '/cp-service-user-pages-integ';
const OWNER_USERNAME = 'cpServiceUserPagesOwner';
const OWNER_HOME = `/user/${OWNER_USERNAME}`;
const MISSING_HOME = '/user/cpServiceUserPagesNobody';
const BACKGROUND = { kind: 'background' } as const;

describe('Change Proposals and the protection of user pages', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let userTopExisted = false;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceUserPagesRequester',
      subscriber: 'cpServiceUserPagesSubscriber',
      other: OWNER_USERNAME,
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');
  let seq = 0;

  const userPagePath = (label: string): string => {
    seq += 1;
    return `${OWNER_HOME}/${label}-${seq}`;
  };

  const createPageAt = async (
    path: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await crowi.pageService.create(
      path,
      'base body',
      users.other,
      {},
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const moveInput = (
    page: HydratedDocument<PageDocument>,
    toPath: string,
  ): Extract<CreatableOperationInput, { type: 'move' }> => ({
    type: 'move',
    pageId: page._id.toString(),
    fromPath: page.path,
    toPath,
  });

  const editInput = (
    page: HydratedDocument<PageDocument>,
  ): Extract<CreatableOperationInput, { type: 'edit' }> => {
    const op = kit.editInput(page, 'proposed body');
    if (op.type !== 'edit') throw new Error('not an edit');
    return op;
  };

  // A valid first operation, so the refusal must name the second one.
  const createProposalWith = (op: CreatableOperationInput) =>
    service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [
        { type: 'create', path: kit.nextPath('valid'), body: 'x' },
        op,
      ],
      request: { ip: TEST_IP },
    });

  const applyStored = async (operations: readonly CreateOperationInput[]) => {
    const proposal = await kit.storeProposal(operations);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const setUserPagesDisabled = (value: boolean) =>
    configManager.updateConfigs({ 'security:disableUserPages': value });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    userTopExisted = (await Page().exists({ path: '/user' })) != null;
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
    await configManager.updateConfigs(
      { 'security:disableUserPages': undefined },
      { removeIfUndefined: true },
    );
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const pages = await Page().find({
      path: new RegExp(
        `^(/trash)?(${OWNER_HOME}|${MISSING_HOME}|${PREFIX})(/|$)`,
      ),
    });
    const leftovers = userTopExisted
      ? pages
      : [...pages, ...(await Page().find({ path: '/user' }))];
    await prisma.revisions.deleteMany({
      where: { pageId: { in: leftovers.map((p) => p._id.toString()) } },
    });
    await Page().deleteMany({ _id: { $in: leftovers.map((p) => p._id) } });
    await prisma.pageredirects.deleteRedirectsFromPathTree(PREFIX);
    await prisma.pageredirects.deleteRedirectsFromPathTree(OWNER_HOME);
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await kit.tearDown();
  });

  describe('with user pages disabled by the admin', () => {
    it('refuses, at creation, an edit of a user page', async () => {
      const page = await createPageAt(userPagePath('edit'));
      await setUserPagesDisabled(true);

      await expect(createProposalWith(editInput(page))).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 1 },
      });
    });

    it('refuses, at creation, a create under /user', async () => {
      await setUserPagesDisabled(true);

      await expect(
        createProposalWith({
          type: 'create',
          path: userPagePath('create'),
          body: 'x',
        }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 1 },
      });
    });

    it('refuses, at creation, a move into /user and a move out of it', async () => {
      const outside = await kit.createPage('move-in');
      const inside = await createPageAt(userPagePath('move-out'));
      await setUserPagesDisabled(true);

      await expect(
        createProposalWith(moveInput(outside, userPagePath('moved-in'))),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 1 },
      });
      await expect(
        createProposalWith(moveInput(inside, kit.nextPath('moved-out'))),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 1 },
      });
    });

    it('fails, at apply, the stored edit, create and move that touch /user, writing nothing there', async () => {
      const edited = await createPageAt(userPagePath('stored-edit'));
      const outside = await kit.createPage('stored-move');
      const createPath = userPagePath('stored-create');
      const moveTo = userPagePath('stored-moved');
      await setUserPagesDisabled(true);

      const applied = await applyStored([
        editInput(edited),
        { type: 'create', path: createPath, body: 'x' },
        moveInput(outside, moveTo),
      ]);

      expect(applied.operations.map((op) => [op.status, op.reason])).toEqual([
        ['failed', 'target-unavailable'],
        ['failed', 'target-unavailable'],
        ['failed', 'target-unavailable'],
      ]);
      expect((await kit.findPage(edited._id)).revision?.toString()).toBe(
        edited.revision?.toString(),
      );
      expect(await Page().exists({ path: createPath })).toBeNull();
      expect((await kit.findPage(outside._id)).path).toBe(outside.path);
      expect(await Page().exists({ path: moveTo })).toBeNull();
    });
  });

  describe('with user pages enabled', () => {
    it('creates and applies an edit, a create and a move under an existing user home', async () => {
      const edited = await createPageAt(userPagePath('allowed-edit'));
      const outside = await kit.createPage('allowed-move');
      const createPath = userPagePath('allowed-create');
      const moveTo = userPagePath('allowed-moved');

      const proposedEdit = await createPageAt(userPagePath('proposed-edit'));
      const proposedMove = await kit.createPage('proposed-move');
      await expect(
        createProposalWith(editInput(proposedEdit)),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        createProposalWith({
          type: 'create',
          path: userPagePath('proposed-create'),
          body: 'x',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        createProposalWith(
          moveInput(proposedMove, userPagePath('proposed-moved')),
        ),
      ).resolves.toMatchObject({ ok: true });

      const applied = await applyStored([
        editInput(edited),
        { type: 'create', path: createPath, body: 'x' },
        moveInput(outside, moveTo),
      ]);

      expect(applied.operations.map((op) => op.status)).toEqual([
        'applied',
        'applied',
        'applied',
      ]);
      expect((await kit.findPage(outside._id)).path).toBe(moveTo);
    });

    it("refuses, at creation, a create or a move under a non-existent user's home", async () => {
      const outside = await kit.createPage('missing-owner-move');

      await expect(
        createProposalWith({
          type: 'create',
          path: `${MISSING_HOME}/create-${seq}`,
          body: 'x',
        }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 1 },
      });
      await expect(
        createProposalWith(moveInput(outside, `${MISSING_HOME}/move-${seq}`)),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'target-unavailable', index: 1 },
      });
    });

    it("fails, at apply, a stored create or move under a non-existent user's home", async () => {
      const outside = await kit.createPage('missing-owner-stored');
      const createPath = `${MISSING_HOME}/stored-create-${seq}`;
      const moveTo = `${MISSING_HOME}/stored-move-${seq}`;

      const applied = await applyStored([
        { type: 'create', path: createPath, body: 'x' },
        moveInput(outside, moveTo),
      ]);

      expect(applied.operations.map((op) => [op.status, op.reason])).toEqual([
        ['failed', 'target-unavailable'],
        ['failed', 'target-unavailable'],
      ]);
      expect(await Page().exists({ path: createPath })).toBeNull();
      expect((await kit.findPage(outside._id)).path).toBe(outside.path);
    });
  });
});
