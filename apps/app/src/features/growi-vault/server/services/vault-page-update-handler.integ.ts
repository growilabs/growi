import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { RevisionConflictError } from '~/server/models/errors';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import SyncPageStatusService from '~/server/service/system-events/sync-page-status';
import { prisma } from '~/utils/prisma';

import { VaultInstruction } from '../models/vault-instruction';
import { COALESCE_WINDOW_MS, createVaultDispatcher } from './vault-dispatcher';
import { vaultNamespaceMapper } from './vault-namespace-mapper';
import {
  createVaultPageUpdateHandler,
  type VaultPageUpdateHandler,
} from './vault-page-update-handler';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_PREFIX = `/vault-page-update-integ-${WORKER_ID}`;

describe('Vault instructions written for a single-page update', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let creator: HydratedDocument<IUserHasId>;
  let editor: HydratedDocument<IUserHasId>;
  let isV5CompatibleBefore: boolean;

  // Results of the Vault subscriber for the events emitted so far.
  let handled: Promise<void>[];
  const handlePageUpdate = createVaultPageUpdateHandler(
    createVaultDispatcher(vaultNamespaceMapper),
    vaultNamespaceMapper,
  );

  const createUser = async (
    name: string,
  ): Promise<HydratedDocument<IUserHasId>> => {
    const username = `vault-page-update-integ-${name}-${WORKER_ID}`;
    return crowi.models.User.create({
      name: username,
      username,
      email: `${username}@example.com`,
    });
  };

  const createPublicPage = async (
    name: string,
    onTree: boolean,
  ): Promise<HydratedDocument<PageDocument>> => {
    const root = await Page.findOne({ path: '/' });
    const page = await Page.create({
      path: `${PATH_PREFIX}/${name}`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: creator._id,
      lastUpdateUser: creator._id,
      parent: onTree ? root?._id : null,
    });
    const revision = await prisma.revisions.create({
      data: {
        pageId: String(page._id),
        body: 'initial body',
        format: 'markdown',
        authorId: String(creator._id),
      },
    });
    page.revision = revision.id;
    return page.save();
  };

  /** Waits until the Vault subscriber has written everything it was handed. */
  const deliverEmittedUpdates = async (): Promise<void> => {
    await Promise.all(handled);
    handled = [];
    await new Promise((resolve) => setTimeout(resolve, COALESCE_WINDOW_MS * 2));
  };

  const writtenInstructions = async (
    page: PageDocument,
  ): Promise<Array<[string, string | undefined]>> => {
    const docs = await VaultInstruction.find({
      'payload.pageId': String(page._id),
    }).lean();
    return docs
      .map((doc): [string, string | undefined] => [
        doc.op,
        doc.payload.namespace,
      ])
      .sort();
  };

  beforeAll(async () => {
    crowi = await getInstance();
    isV5CompatibleBefore = crowi.configManager.getConfig('app:isV5Compatible');
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    Page = mongoose.model<PageDocument, PageModel>('Page');

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }
    creator = await createUser('creator');
    editor = await createUser('editor');

    // Same listener order as the running app: the page-status broadcaster is
    // registered before the Vault subscriber.
    new SyncPageStatusService(crowi, undefined, crowi.socketIoService);
    crowi.events.page.on(
      'update',
      (
        ...[page, , extras]: [
          Parameters<VaultPageUpdateHandler>[0],
          unknown,
          Parameters<VaultPageUpdateHandler>[1],
        ]
      ) => {
        handled.push(handlePageUpdate(page, extras));
      },
    );
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();
  }, 60_000);

  beforeEach(() => {
    handled = [];
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await crowi.configManager.updateConfig(
      'app:isV5Compatible',
      isV5CompatibleBefore,
    );
    const pages = await Page.find({
      path: { $regex: `^${PATH_PREFIX}/` },
    });
    const pageIds = pages.map((page) => String(page._id));
    await VaultInstruction.deleteMany({ 'payload.pageId': { $in: pageIds } });
    await prisma.revisions.deleteMany({ where: { pageId: { in: pageIds } } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await crowi.models.User.deleteMany({
      _id: { $in: [creator._id, editor._id] },
    });
    const groups = await UserGroup.find({
      name: `vault-page-update-integ-group-${WORKER_ID}`,
    });
    const groupIds = groups.map((group) => group._id);
    await UserGroupRelation.deleteMany({ relatedGroup: { $in: groupIds } });
    await UserGroup.deleteMany({ _id: { $in: groupIds } });
  });

  it('moves a public page to the namespace of the user who set it to only-me, not of its creator', async () => {
    const page = await createPublicPage('to-only-me', true);

    await crowi.pageService.updateGrant(page, editor, {
      grant: PageGrant.GRANT_OWNER,
      userRelatedGrantedGroups: [],
    });
    await deliverEmittedUpdates();

    expect(await writtenInstructions(page)).toEqual([
      ['remove', 'public'],
      ['upsert', `user-${editor._id}-only-me`],
    ]);
  });

  it('moves an only-me page back to public', async () => {
    const page = await createPublicPage('back-to-public', true);
    await crowi.pageService.updateGrant(page, editor, {
      grant: PageGrant.GRANT_OWNER,
      userRelatedGrantedGroups: [],
    });
    await deliverEmittedUpdates();
    await VaultInstruction.deleteMany({ 'payload.pageId': String(page._id) });

    await crowi.pageService.updateGrant(page, editor, {
      grant: PageGrant.GRANT_PUBLIC,
      userRelatedGrantedGroups: [],
    });
    await deliverEmittedUpdates();

    expect(await writtenInstructions(page)).toEqual([
      ['remove', `user-${editor._id}-only-me`],
      ['upsert', 'public'],
    ]);
  });

  it('writes no remove for a body edit of a group page', async () => {
    const group = await UserGroup.create({
      name: `vault-page-update-integ-group-${WORKER_ID}`,
    });
    await UserGroupRelation.create({
      relatedGroup: group._id,
      relatedUser: editor._id,
    });
    const page = await createPublicPage('group-body-edit', true);
    page.grant = PageGrant.GRANT_USER_GROUP;
    page.grantedGroups = [{ type: GroupType.userGroup, item: group._id }];
    await page.save();

    await crowi.pageService.updatePage(
      page,
      'updated body',
      'initial body',
      editor,
      {},
    );
    await deliverEmittedUpdates();

    expect(await writtenInstructions(page)).toEqual([
      ['upsert', `group-${group._id}`],
    ]);
  });

  it('writes no remove for a body edit that keeps the grant', async () => {
    const page = await createPublicPage('body-edit', true);

    await crowi.pageService.updatePage(
      page,
      'updated body',
      'initial body',
      editor,
      {},
    );
    await deliverEmittedUpdates();

    expect(await writtenInstructions(page)).toEqual([['upsert', 'public']]);
  });

  describe('when a save that changes body and grant loses a revision conflict', () => {
    const saveWithStaleRevision = async (
      page: HydratedDocument<PageDocument>,
    ): Promise<void> => {
      await expect(
        crowi.pageService.updatePage(
          page,
          'updated body',
          'initial body',
          editor,
          {
            grant: PageGrant.GRANT_OWNER,
            expectedRevisionId: new mongoose.Types.ObjectId().toString(),
          },
        ),
      ).rejects.toThrow(RevisionConflictError);
    };

    it.each([
      { name: 'conflict-on-tree', onTree: true },
      { name: 'conflict-legacy', onTree: false },
    ])('keeps the grant and writes nothing ($name)', async ({
      name,
      onTree,
    }) => {
      const page = await createPublicPage(name, onTree);

      await saveWithStaleRevision(page);
      await deliverEmittedUpdates();

      expect((await Page.findById(page._id).orFail()).grant).toBe(
        PageGrant.GRANT_PUBLIC,
      );
      expect(await writtenInstructions(page)).toEqual([]);
    });

    it.each([
      { name: 'conflict-retry-on-tree', onTree: true },
      { name: 'conflict-retry-legacy', onTree: false },
    ])('moves the page once the save is retried from a fresh read ($name)', async ({
      name,
      onTree,
    }) => {
      const page = await createPublicPage(name, onTree);

      await saveWithStaleRevision(page);
      const reread = await Page.findById(page._id).orFail();
      await crowi.pageService.updatePage(
        reread,
        'updated body',
        'initial body',
        editor,
        {
          grant: PageGrant.GRANT_OWNER,
          expectedRevisionId: String(reread.revision),
        },
      );
      await deliverEmittedUpdates();

      expect(await writtenInstructions(page)).toEqual([
        ['remove', 'public'],
        ['upsert', `user-${editor._id}-only-me`],
      ]);
    });
  });

  it('moves a page that is not on the page tree (legacy update path)', async () => {
    const page = await createPublicPage('legacy-to-only-me', false);

    await crowi.pageService.updateGrant(page, editor, {
      grant: PageGrant.GRANT_OWNER,
      userRelatedGrantedGroups: [],
    });
    await deliverEmittedUpdates();

    expect(await writtenInstructions(page)).toEqual([
      ['remove', 'public'],
      ['upsert', `user-${editor._id}-only-me`],
    ]);
  });
});
