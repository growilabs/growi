import { EventEmitter } from 'node:events';
import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { prisma } from '~/utils/prisma';

import { BULK_REINDEX_SIZE } from '../consts';
import { runDescendantDuplicationV4 } from './run-descendant-duplication-v4';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/run-descendant-duplication-v4-integ-${WORKER_ID}`;
const USERNAME_PREFIX = `runDescendantDuplicationV4Integ${WORKER_ID}`;

const newId = (): string => new Types.ObjectId().toHexString();

describe('runDescendantDuplicationV4', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let owner: HydratedDocument<IUserHasId>;
  let otherUser: HydratedDocument<IUserHasId>;
  const createdUserIds: string[] = [];
  const sourceAuthorId = newId();

  const createUser = async (): Promise<HydratedDocument<IUserHasId>> => {
    const username = `${USERNAME_PREFIX}u${createdUserIds.length + 1}`;
    const user = await mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: 2,
    });
    createdUserIds.push(String(user._id));
    return user;
  };

  // v4 pages sit outside the page tree: parent is null.
  const createV4Page = async (
    path: string,
    bodies: readonly string[],
    grant: {
      grant: PageGrant;
      grantedUsers?: string[];
      grantedGroupIds?: string[];
    } = {
      grant: PageGrant.GRANT_PUBLIC,
    },
  ): Promise<void> => {
    const pageId = newId();
    const revisionIds = bodies.map(() => newId());
    // The old v4 keyed revisions by pageId and let a later one overwrite, so
    // the older revisions are inserted AFTER the latest one.
    await prisma.revisions.createMany({
      data: bodies.map((body, i) => ({
        id: revisionIds[i],
        pageId,
        body,
        authorId: sourceAuthorId,
        format: 'markdown',
      })),
    });
    await Page.create({
      _id: pageId,
      path,
      parent: null,
      grant: grant.grant,
      grantedUsers: grant.grantedUsers ?? [],
      grantedGroups: (grant.grantedGroupIds ?? []).map((item) => ({
        item,
        type: GroupType.userGroup,
      })),
      revision: revisionIds[0],
    });
  };

  let pageEvent: EventEmitter;
  const createdGroupIds: string[] = [];
  const createdTagIds: string[] = [];

  const run = (sourcePath: string, newPagePath: string) =>
    runDescendantDuplicationV4(
      { pageGrantService: crowi.pageGrantService, pageEvent },
      { sourcePath, newPagePath, user: owner },
    );

  const findCopies = (newPrefix: string) =>
    Page.find({ path: { $regex: `^${newPrefix}` } }).lean();

  beforeEach(() => {
    pageEvent = new EventEmitter();
  });

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    owner = await createUser();
    otherUser = await createUser();
  });

  afterAll(async () => {
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await prisma.revisions.deleteMany({
      where: { authorId: { in: [sourceAuthorId, ...createdUserIds] } },
    });
    await prisma.pagetagrelations.deleteMany({
      where: { relatedTagId: { in: createdTagIds } },
    });
    await prisma.tags.deleteMany({ where: { id: { in: createdTagIds } } });
    await UserGroupRelation.deleteMany({
      relatedGroup: { $in: createdGroupIds },
    });
    await UserGroup.deleteMany({ _id: { $in: createdGroupIds } });
    await mongoose.model('User').deleteMany({ _id: { $in: createdUserIds } });
  });

  it('copies the descendants with the latest revision body and exactly one revision per copy', async () => {
    const src = `${PATH_ROOT}/latest`;
    await createV4Page(src, ['root current']);
    await createV4Page(`${src}/a`, ['a current', 'a old 1', 'a old 2']);
    await createV4Page(`${src}/a/b`, ['b current', 'b old']);

    await run(src, `${src}-copy`);

    const copies = await findCopies(`${src}-copy/`);
    expect(copies.map((p) => p.path).sort()).toEqual([
      `${src}-copy/a`,
      `${src}-copy/a/b`,
    ]);
    for (const copy of copies) {
      // biome-ignore lint/performance/noAwaitInLoops: two pages, readability first
      const revisions = await prisma.revisions.findMany({
        where: { pageId: copy._id.toString() },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0].id).toBe(copy.revision?.toString());
      expect(revisions[0].body).toBe(
        copy.path.endsWith('/b') ? 'b current' : 'a current',
      );
      expect(copy.creator?.toString()).toBe(owner._id.toString());
      expect(copy.lastUpdateUser?.toString()).toBe(owner._id.toString());
    }
  });

  it('emits syncDescendantsUpdate once with the destination path so that the copies are indexed', async () => {
    const src = `${PATH_ROOT}/emit`;
    await createV4Page(src, ['root']);
    await createV4Page(`${src}/a`, ['a']);
    const emitted: unknown[][] = [];
    pageEvent.on('syncDescendantsUpdate', (...args) => emitted.push(args));

    await run(src, `${src}-copy`);

    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({ path: `${src}-copy` });
    expect(emitted[0][1]).toBe(owner);
  });

  it('keeps every granted group of a copied page, whether or not the user belongs to it', async () => {
    const src = `${PATH_ROOT}/groups`;
    const groupA = await UserGroup.create({
      name: `${USERNAME_PREFIX}-a-${newId()}`,
    });
    const groupB = await UserGroup.create({
      name: `${USERNAME_PREFIX}-b-${newId()}`,
    });
    createdGroupIds.push(String(groupA._id), String(groupB._id));
    await UserGroupRelation.create({
      relatedGroup: groupA._id,
      relatedUser: owner._id,
      createdAt: new Date(),
    });
    await createV4Page(src, ['root']);
    await createV4Page(`${src}/grouped`, ['grouped'], {
      grant: PageGrant.GRANT_USER_GROUP,
      grantedGroupIds: [String(groupA._id), String(groupB._id)],
    });

    await run(src, `${src}-copy`);

    const [copy] = await findCopies(`${src}-copy/`);
    expect(copy.grantedGroups.map((g) => String(g.item)).sort()).toEqual(
      [String(groupA._id), String(groupB._id)].sort(),
    );
  });

  it('does not copy descendants the user cannot edit, nor the source page itself', async () => {
    const src = `${PATH_ROOT}/editable`;
    await createV4Page(src, ['root']);
    await createV4Page(`${src}/open`, ['open']);
    await createV4Page(`${src}/private`, ['private'], {
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [otherUser._id.toString()],
    });

    await run(src, `${src}-copy`);

    const paths = (await findCopies(`${src}-copy`)).map((p) => p.path);
    expect(paths).toEqual([`${src}-copy/open`]);
  });

  it('does not copy pages that are on the page tree', async () => {
    const src = `${PATH_ROOT}/ontree`;
    await createV4Page(src, ['root']);
    await createV4Page(`${src}/v4`, ['v4']);
    // Copyable (has a current revision) but on the page tree.
    await createV4Page(`${src}/v5`, ['v5']);
    await Page.updateOne(
      { path: `${src}/v5` },
      { $set: { parent: new Types.ObjectId() } },
    );

    await run(src, `${src}-copy`);

    expect((await findCopies(`${src}-copy`)).map((p) => p.path)).toEqual([
      `${src}-copy/v4`,
    ]);
  });

  it('keeps copying the rest of the batch and the later batches when new paths are already taken under a unique path index', async () => {
    const src = `${PATH_ROOT}/taken`;
    const dest = `${src}-copy`;
    const tagId = newId();
    await prisma.tags.createMany({
      data: [{ id: tagId, name: `tag-${tagId}` }],
    });
    createdTagIds.push(tagId);
    await createV4Page(src, ['root']);
    // Two read batches; more than half of the targets are taken, so the first
    // batch has a collision whatever order the cursor reads in.
    const children = Array.from(
      { length: BULK_REINDEX_SIZE * 1.5 },
      (_, i) => ({
        pageId: newId(),
        revisionId: newId(),
        name: `p${String(i).padStart(3, '0')}`,
        taken: i % 2 === 0,
      }),
    );
    await prisma.revisions.createMany({
      data: children.map((c) => ({
        id: c.revisionId,
        pageId: c.pageId,
        body: c.name,
        authorId: sourceAuthorId,
        format: 'markdown',
      })),
    });
    await Page.insertMany(
      children.map((c) => ({
        _id: c.pageId,
        path: `${src}/${c.name}`,
        parent: null,
        grant: PageGrant.GRANT_PUBLIC,
        revision: c.revisionId,
      })),
    );
    await prisma.pagetagrelations.createMany({
      data: children.map((c) => ({
        relatedPageId: c.pageId,
        relatedTagId: tagId,
      })),
    });
    const uniqueIndex = `unique_path_v4_${WORKER_ID}`;
    await Page.collection.createIndex(
      { path: 1 },
      {
        name: uniqueIndex,
        unique: true,
        partialFilterExpression: {
          path: { $gte: `${dest}/`, $lt: `${dest}0` },
        },
      },
    );
    try {
      await Page.insertMany(
        children
          .filter((c) => c.taken)
          .map((c) => ({ path: `${dest}/${c.name}`, parent: null })),
      );

      await run(src, dest);
    } finally {
      await Page.collection.dropIndex(uniqueIndex);
    }

    const copies = await Page.find({
      creator: owner._id,
      path: { $regex: `^${dest}/` },
    }).lean();
    expect(copies.map((p) => p.path).sort()).toEqual(
      children.filter((c) => !c.taken).map((c) => `${dest}/${c.name}`),
    );
    const copiedTagRelations = await prisma.pagetagrelations.findMany({
      where: {
        relatedTagId: tagId,
        relatedPageId: { notIn: children.map((c) => c.pageId) },
      },
    });
    expect(copiedTagRelations.map((r) => r.relatedPageId).sort()).toEqual(
      copies.map((p) => p._id.toString()).sort(),
    );
  });

  it('resolves without rejecting when copying fails', async () => {
    const src = `${PATH_ROOT}/failing`;
    await createV4Page(src, ['root']);
    await createV4Page(`${src}/a`, ['a']);
    const emitted: unknown[][] = [];
    pageEvent.on('syncDescendantsUpdate', (...args) => emitted.push(args));
    const insertMany = vi
      .spyOn(Page, 'insertMany')
      .mockRejectedValueOnce(new Error('injected failure'));

    try {
      await expect(run(src, `${src}-copy`)).resolves.toBeUndefined();
    } finally {
      insertMany.mockRestore();
    }
    expect(await findCopies(`${src}-copy`)).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({ path: `${src}-copy` });
  });
});
