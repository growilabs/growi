import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
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

  // Each element is the argument list of one 'update' emit from PageService.
  let emittedUpdates: Parameters<VaultPageUpdateHandler>[];
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

  /** Hands every 'update' PageService emitted to the Vault subscriber. */
  const deliverEmittedUpdates = async (): Promise<void> => {
    for (const args of emittedUpdates) {
      // biome-ignore lint/performance/noAwaitInLoops: deliver in emit order
      await handlePageUpdate(...args);
    }
    emittedUpdates = [];
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
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    Page = mongoose.model<PageDocument, PageModel>('Page');

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }
    creator = await createUser('creator');
    editor = await createUser('editor');

    // Capture the 'update' emits instead of running the app-wide listeners,
    // whose background DB work would outlive the test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockImplementation(
      (event, page, _user, extras) => {
        if (event === 'update') {
          emittedUpdates.push([page, extras]);
        }
        return true;
      },
    );
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();
  }, 60_000);

  beforeEach(() => {
    emittedUpdates = [];
  });

  afterAll(async () => {
    vi.restoreAllMocks();
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
