import assert from 'node:assert';
import { type IUser, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import { VaultInstruction } from '../models/vault-instruction';
import { subscribeToDescendantsRename } from './vault-descendants-rename-handler';
import {
  createVaultDispatcher,
  type VaultDispatcher,
} from './vault-dispatcher';
import { vaultNamespaceMapper } from './vault-namespace-mapper';

const OLD_PATH = '/vault-descendants-rename-seam/before';
const NEW_PATH = '/vault-descendants-rename-seam/after';
const USERNAME = 'vault-descendants-rename-seam-user';

// Fills one batch (BULK_REINDEX_SIZE) so the two pages added after it land in a later batch.
const PUBLIC_CHILDREN_FILLING_ONE_BATCH = 100;

describe('PageService descendant rename → vault_instructions', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUser>;
  let user: HydratedDocument<IUser>;
  let unsubscribe: () => void;

  const renamePrefixInstructions = (newPrefix: string) =>
    VaultInstruction.find({
      op: 'rename-prefix',
      'payload.newPrefix': newPrefix,
    }).lean();

  // The subscriber writes without being awaited by PageService, so the test
  // collects the writes it started to know when all of them have finished.
  const startedWrites: Promise<void>[] = [];
  const allWritesFinished = async (): Promise<void> => {
    await Promise.allSettled(startedWrites.splice(0));
  };

  const renameDescendants = (
    target: { _id: unknown; path: string },
    newPath: string,
  ): Promise<void> =>
    // biome-ignore lint/suspicious/noExplicitAny: renameDescendantsWithStream is private
    (crowi.pageService as any).renameDescendantsWithStream(
      target,
      newPath,
      user,
      {},
      false,
      new Set(),
    );

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model('Page') as PageModel;
    User = mongoose.model('User');

    user = await User.create({
      name: USERNAME,
      username: USERNAME,
      email: `${USERNAME}@example.com`,
    });

    const dispatcher = createVaultDispatcher(vaultNamespaceMapper);
    const trackedDispatcher: Pick<
      VaultDispatcher,
      'onPageRenamed' | 'onBulkOperation'
    > = {
      onPageRenamed: (event) => dispatcher.onPageRenamed(event),
      onBulkOperation: (event) => {
        const write = dispatcher.onBulkOperation(event);
        startedWrites.push(write);
        return write;
      },
    };
    unsubscribe = subscribeToDescendantsRename(
      crowi.events.page,
      trackedDispatcher,
      vaultNamespaceMapper,
    );
  });

  afterAll(async () => {
    unsubscribe();
    await Page.deleteMany({ path: /^\/vault-descendants-rename-seam\// });
    await VaultInstruction.deleteMany({
      'payload.newPrefix': /^\/vault-descendants-rename-seam\//,
    });
    await User.deleteOne({ _id: user._id });
  });

  it('writes one rename-prefix per namespace, with plain page paths, for descendants spanning several batches', async () => {
    const target = await Page.create({
      path: OLD_PATH,
      parent: new mongoose.Types.ObjectId(),
      grant: PageGrant.GRANT_PUBLIC,
      creator: user,
      lastUpdateUser: user,
    });
    const child = (name: string, grant: PageGrant) => ({
      path: `${OLD_PATH}/${name}`,
      parent: target._id,
      grant,
      grantedUsers: grant === PageGrant.GRANT_OWNER ? [user._id] : [],
      creator: user,
      lastUpdateUser: user,
    });
    await Page.insertMany([
      ...Array.from({ length: PUBLIC_CHILDREN_FILLING_ONE_BATCH }, (_, i) =>
        child(`public${i}`, PageGrant.GRANT_PUBLIC),
      ),
      child('only-me', PageGrant.GRANT_OWNER),
      child('public-last', PageGrant.GRANT_PUBLIC),
    ]);

    await renameDescendants(target, NEW_PATH);

    const onlyMeNamespace = `user-${user._id.toString()}-only-me`;
    await allWritesFinished();

    const instructions = await renamePrefixInstructions(NEW_PATH);
    expect(
      instructions.map((instruction) => instruction.payload.namespace).sort(),
    ).toEqual(['public', onlyMeNamespace].sort());
    for (const instruction of instructions) {
      expect(instruction.payload.oldPrefix).toBe(OLD_PATH);
      expect(instruction.payload.newPrefix).toBe(NEW_PATH);
    }

    assert((await Page.exists({ path: `${NEW_PATH}/only-me` })) != null);
  });

  it('writes the rename-prefix again when the same subtree is renamed back', async () => {
    const there = '/vault-descendants-rename-seam/there';
    const back = '/vault-descendants-rename-seam/back';
    const target = await Page.create({
      path: there,
      parent: new mongoose.Types.ObjectId(),
      grant: PageGrant.GRANT_PUBLIC,
      creator: user,
      lastUpdateUser: user,
    });
    await Page.create({
      path: `${there}/child`,
      parent: target._id,
      grant: PageGrant.GRANT_PUBLIC,
      creator: user,
      lastUpdateUser: user,
    });

    await renameDescendants(target, back);
    await renameDescendants({ _id: target._id, path: back }, there);
    await allWritesFinished();

    expect(await renamePrefixInstructions(back)).toHaveLength(1);
    const instructions = await renamePrefixInstructions(there);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].payload).toMatchObject({
      namespace: 'public',
      oldPrefix: back,
      newPrefix: there,
    });
  });
});
