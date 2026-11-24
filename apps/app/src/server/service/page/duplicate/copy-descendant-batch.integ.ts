import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import type { Document } from 'mongodb';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { prisma } from '~/utils/prisma';

import {
  copyDescendantBatch,
  type DescendantBatchInput,
} from './copy-descendant-batch';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/copy-descendant-batch-integ-${WORKER_ID}`;

const newId = (): string => new Types.ObjectId().toHexString();

class ProgressRefused extends Error {}

interface SourcePageSeed {
  readonly path: string;
  readonly grant?: PageGrant;
  readonly grantedGroupIds?: readonly string[];
  readonly grantedUserIds?: readonly string[];
  readonly isEmpty?: boolean;
  /** The first body is the current revision; the rest are older revisions. */
  readonly bodies?: readonly string[];
  /** When true, page.revision points to a revision that does not exist. */
  readonly hasMissingRevision?: boolean;
  /** Stored as-is, bypassing schema validation, so that its copy fails validation. */
  readonly storedGrantedGroupType?: string;
  readonly tagIds?: readonly string[];
}

describe('copyDescendantBatch', () => {
  let crowi: Crowi;
  let Page: PageModel;
  const sourceAuthorId = newId();
  const userIds: string[] = [];
  const tagIds: string[] = [];
  const groupIds: string[] = [];
  let userCounter = 0;

  const createUser = async (): Promise<HydratedDocument<IUserHasId>> => {
    userCounter += 1;
    const username = `copy-descendant-batch-${WORKER_ID}-${userCounter}`;
    await crowi.models.User.deleteMany({ username });
    const user: HydratedDocument<IUserHasId> = await crowi.models.User.create({
      name: username,
      username,
      email: `${username}@example.com`,
    });
    userIds.push(user._id.toString());
    return user;
  };

  const createTag = async (): Promise<string> => {
    const id = newId();
    await prisma.tags.createMany({ data: [{ id, name: `tag-${id}` }] });
    tagIds.push(id);
    return id;
  };

  const createUserGroup = async (memberId?: string): Promise<string> => {
    const group = await UserGroup.create({ name: `group-${newId()}` });
    if (memberId != null) {
      await UserGroupRelation.create({
        relatedGroup: group._id,
        relatedUser: memberId,
        createdAt: new Date(),
      });
    }
    groupIds.push(group._id.toString());
    return group._id.toString();
  };

  // Returns the source pages as lean documents, the shape the descendant cursor yields.
  const seedSourcePages = async (
    seeds: readonly SourcePageSeed[],
  ): Promise<PageDocument[]> => {
    const pageIds: string[] = [];
    for (const seed of seeds) {
      const pageId = newId();
      pageIds.push(pageId);
      let revisionId: string | undefined;
      if (seed.hasMissingRevision) {
        revisionId = newId();
      } else if (seed.bodies != null) {
        // The current revision is stored first, older ones after it, so a
        // lookup by pageId in natural order would land on an older body.
        const revisionIds = seed.bodies.map(() => newId());
        revisionId = revisionIds[0];
        // biome-ignore lint/performance/noAwaitInLoops: insertion order matters (see above)
        await prisma.revisions.createMany({
          data: seed.bodies.map((body, i) => ({
            id: revisionIds[i],
            pageId,
            body,
            authorId: sourceAuthorId,
            format: 'markdown',
          })),
        });
      }
      await Page.create({
        _id: pageId,
        path: seed.path,
        isEmpty: seed.isEmpty ?? false,
        grant: seed.grant ?? PageGrant.GRANT_PUBLIC,
        grantedGroups: (seed.grantedGroupIds ?? []).map((item) => ({
          item,
          type: GroupType.userGroup,
        })),
        grantedUsers: seed.grantedUserIds ?? [],
        revision: revisionId,
      });
      if (seed.storedGrantedGroupType != null) {
        await Page.collection.updateOne(
          { _id: new Types.ObjectId(pageId) },
          { $set: { 'grantedGroups.$[].type': seed.storedGrantedGroupType } },
        );
      }
      if (seed.tagIds != null && seed.tagIds.length > 0) {
        await prisma.pagetagrelations.createMany({
          data: seed.tagIds.map((relatedTagId) => ({
            relatedPageId: pageId,
            relatedTagId,
          })),
        });
      }
    }
    return Page.find({ _id: { $in: pageIds } }).lean<PageDocument[]>();
  };

  const batchInput = (
    overrides: Pick<DescendantBatchInput, 'pages' | 'user'> &
      Partial<DescendantBatchInput>,
    caseName: string,
  ): DescendantBatchInput => ({
    oldPathPrefix: new RegExp(
      `^${RegExp.escape(`${PATH_ROOT}/${caseName}`)}`,
      'i',
    ),
    newPathPrefix: `${PATH_ROOT}/${caseName}-copy`,
    onlyDuplicateUserRelatedResources: false,
    recordProgress: async () => {},
    ...overrides,
  });

  const run = (input: DescendantBatchInput) =>
    copyDescendantBatch({ pageGrantService: crowi.pageGrantService }, input);

  const findCopiedPages = (user: HydratedDocument<IUserHasId>) =>
    Page.find({ creator: user._id }).lean();

  const countRevisionsAuthoredBy = (user: HydratedDocument<IUserHasId>) =>
    prisma.revisions.count({ where: { authorId: user._id.toString() } });

  const countRelationsOfTag = (tagId: string) =>
    prisma.pagetagrelations.count({ where: { relatedTagId: tagId } });

  // Prisma reaches MongoDB through its own engine, so its reads are observed on
  // the server with the profiler instead of by spying on a client.
  const profileRevisionCommands = async (
    fn: () => Promise<void>,
  ): Promise<Document[]> => {
    const { db } = mongoose.connection;
    // the profiler stamps entries with the server clock, which may differ from this process's
    const { localTime: startedAt } = await db.command({ hello: 1 });
    await db.command({ profile: 2 });
    try {
      await fn();
    } finally {
      await db.command({ profile: 0 });
    }
    const entries = await db
      .collection('system.profile')
      .find({ ns: `${db.databaseName}.revisions`, ts: { $gte: startedAt } })
      .toArray();
    // a getMore entry carries the command that opened its cursor
    return entries.map((e) => e.originatingCommand ?? e.command);
  };

  const keysOf = (value: unknown): string[] =>
    value != null && typeof value === 'object' ? Object.keys(value) : [];

  const lastStageOf = (command: Document): unknown =>
    Array.isArray(command.pipeline) ? command.pipeline.at(-1) : undefined;

  /** A $merge stays inside MongoDB; any other read may return only ids. */
  const bringsNoBodyIntoTheProcess = (command: Document): boolean => {
    const lastStage = lastStageOf(command);
    if (keysOf(lastStage).includes('$merge')) return true;
    const projection =
      command.find != null
        ? command.projection
        : (lastStage as Document | undefined)?.$project;
    const projected = keysOf(projection);
    return projected.length > 0 && projected.every((key) => key === '_id');
  };

  // A v4 wiki keeps a unique index on pages.path. Limited to paths under the
  // prefix so that it coexists with path_1 and the other files' pages.
  const withUniquePathIndex = async (
    prefix: string,
    fn: () => Promise<void>,
  ): Promise<void> => {
    const name = `unique_path_${WORKER_ID}`;
    await Page.collection.createIndex(
      { path: 1 },
      {
        name,
        unique: true,
        partialFilterExpression: {
          path: { $gte: `${prefix}/`, $lt: `${prefix}0` },
        },
      },
    );
    try {
      await fn();
    } finally {
      await Page.collection.dropIndex(name);
    }
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}/` } });
  });

  afterAll(async () => {
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}/` } });
    await prisma.revisions.deleteMany({
      where: { authorId: { in: [sourceAuthorId, ...userIds] } },
    });
    await prisma.pagetagrelations.deleteMany({
      where: { relatedTagId: { in: tagIds } },
    });
    await prisma.tags.deleteMany({ where: { id: { in: tagIds } } });
    await UserGroupRelation.deleteMany({ relatedGroup: { $in: groupIds } });
    await UserGroup.deleteMany({ _id: { $in: groupIds } });
    await crowi.models.User.deleteMany({ _id: { $in: userIds } });
  });

  it('copies each page with the body of its current revision and exactly one revision', async () => {
    const user = await createUser();
    const pages = await seedSourcePages([
      {
        path: `${PATH_ROOT}/latest/a`,
        bodies: ['a current', 'a older 1', 'a older 2'],
      },
      { path: `${PATH_ROOT}/latest/b`, bodies: ['b current'] },
    ]);

    const result = await run(batchInput({ pages, user }, 'latest'));

    expect(result.insertedPageCount).toBe(2);
    const copies = await findCopiedPages(user);
    expect(copies.map((p) => p.path).sort()).toEqual([
      `${PATH_ROOT}/latest-copy/a`,
      `${PATH_ROOT}/latest-copy/b`,
    ]);
    for (const copy of copies) {
      const expectedBody = copy.path.endsWith('/a') ? 'a current' : 'b current';
      // biome-ignore lint/performance/noAwaitInLoops: two pages, readability first
      const revisions = await prisma.revisions.findMany({
        where: { pageId: copy._id.toString() },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0].id).toBe(copy.revision?.toString());
      expect(revisions[0].body).toBe(expectedBody);
    }
  });

  it('never reads a revision body into the process (Req 2.1, 2.2, 2.4)', async () => {
    const user = await createUser();
    const pages = await seedSourcePages([
      { path: `${PATH_ROOT}/no-body/a`, bodies: ['a current', 'a older'] },
      { path: `${PATH_ROOT}/no-body/b`, bodies: ['b current'] },
    ]);

    const commands = await profileRevisionCommands(async () => {
      await run(batchInput({ pages, user }, 'no-body'));
    });

    // the profiler did capture this run
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((c) => !bringsNoBodyIntoTheProcess(c))).toEqual([]);
  });

  it('makes the duplicating user the creator and last updater, and replaces only the leading path prefix', async () => {
    const user = await createUser();
    const pages = await seedSourcePages([
      { path: `${PATH_ROOT}/prefix/child/prefix`, bodies: ['body'] },
    ]);

    await run(batchInput({ pages, user }, 'prefix'));

    const [copy] = await findCopiedPages(user);
    expect(copy.path).toBe(`${PATH_ROOT}/prefix-copy/child/prefix`);
    expect(copy.creator?.toString()).toBe(user._id.toString());
    expect(copy.lastUpdateUser?.toString()).toBe(user._id.toString());
  });

  it('does not copy empty pages', async () => {
    const user = await createUser();
    const pages = await seedSourcePages([
      // Has a revision, so only its emptiness keeps it from being copied.
      { path: `${PATH_ROOT}/empty/blank`, isEmpty: true, bodies: ['x'] },
      { path: `${PATH_ROOT}/empty/blank/filled`, bodies: ['filled'] },
    ]);

    const result = await run(batchInput({ pages, user }, 'empty'));

    expect(result.insertedPageCount).toBe(1);
    const copies = await findCopiedPages(user);
    expect(copies.map((p) => p.path)).toEqual([
      `${PATH_ROOT}/empty-copy/blank/filled`,
    ]);
  });

  it('writes nothing when no page in the batch is copied', async () => {
    const user = await createUser();
    const pages = await seedSourcePages([
      { path: `${PATH_ROOT}/nothing/blank`, isEmpty: true, bodies: ['x'] },
    ]);

    const result = await run(batchInput({ pages, user }, 'nothing'));

    expect(result.insertedPageCount).toBe(0);
    expect(await findCopiedPages(user)).toHaveLength(0);
    expect(await countRevisionsAuthoredBy(user)).toBe(0);
  });

  it('copies the tags of each copied page', async () => {
    const user = await createUser();
    const tagA = await createTag();
    const tagB = await createTag();
    const pages = await seedSourcePages([
      { path: `${PATH_ROOT}/tags/a`, bodies: ['a'], tagIds: [tagA, tagB] },
    ]);

    await run(batchInput({ pages, user }, 'tags'));

    const [copy] = await findCopiedPages(user);
    const relations = await prisma.pagetagrelations.findMany({
      where: { relatedPageId: copy._id.toString() },
    });
    expect(relations.map((r) => r.relatedTagId).sort()).toEqual(
      [tagA, tagB].sort(),
    );
  });

  it('skips a page whose current revision could not be copied, together with its tags', async () => {
    const user = await createUser();
    const tag = await createTag();
    const pages = await seedSourcePages([
      {
        path: `${PATH_ROOT}/missing/broken`,
        hasMissingRevision: true,
        tagIds: [tag],
      },
      { path: `${PATH_ROOT}/missing/fine`, bodies: ['fine'] },
    ]);

    const result = await run(batchInput({ pages, user }, 'missing'));

    expect(result.insertedPageCount).toBe(1);
    const copies = await findCopiedPages(user);
    expect(copies.map((p) => p.path)).toEqual([
      `${PATH_ROOT}/missing-copy/fine`,
    ]);
    expect(await countRelationsOfTag(tag)).toBe(1);
  });

  it('neither counts nor tags a page the page model refuses to store', async () => {
    const user = await createUser();
    const tag = await createTag();
    const group = await createUserGroup();
    const pages = await seedSourcePages([
      {
        path: `${PATH_ROOT}/invalid/broken`,
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroupIds: [group],
        storedGrantedGroupType: 'UnknownGroupType',
        bodies: ['broken'],
        tagIds: [tag],
      },
      { path: `${PATH_ROOT}/invalid/fine`, bodies: ['fine'] },
    ]);

    const result = await run(batchInput({ pages, user }, 'invalid'));

    expect(result.insertedPageCount).toBe(1);
    const copies = await findCopiedPages(user);
    expect(copies.map((p) => p.path)).toEqual([
      `${PATH_ROOT}/invalid-copy/fine`,
    ]);
    expect(await countRelationsOfTag(tag)).toBe(1);
  });

  it('skips a page whose new path is already taken under a unique path index, and copies and tags the others', async () => {
    const user = await createUser();
    const tag = await createTag();
    const group = await createUserGroup();
    const pages = await seedSourcePages([
      { path: `${PATH_ROOT}/taken/a`, bodies: ['a'], tagIds: [tag] },
      { path: `${PATH_ROOT}/taken/b`, bodies: ['b'], tagIds: [tag] },
      {
        path: `${PATH_ROOT}/taken/invalid`,
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroupIds: [group],
        storedGrantedGroupType: 'UnknownGroupType',
        bodies: ['invalid'],
        tagIds: [tag],
      },
      { path: `${PATH_ROOT}/taken/c`, bodies: ['c'], tagIds: [tag] },
    ]);

    await withUniquePathIndex(`${PATH_ROOT}/taken-copy`, async () => {
      await Page.create({ path: `${PATH_ROOT}/taken-copy/b` });

      const result = await run(batchInput({ pages, user }, 'taken'));

      expect(result.insertedPageCount).toBe(2);
    });

    const copies = await findCopiedPages(user);
    expect(copies.map((p) => p.path).sort()).toEqual([
      `${PATH_ROOT}/taken-copy/a`,
      `${PATH_ROOT}/taken-copy/c`,
    ]);
    const copiedTagRelations = await prisma.pagetagrelations.findMany({
      where: {
        relatedTagId: tag,
        relatedPageId: { notIn: pages.map((p) => String(p._id)) },
      },
    });
    expect(copiedTagRelations.map((r) => r.relatedPageId).sort()).toEqual(
      copies.map((p) => p._id.toString()).sort(),
    );
  });

  it('fails when the tags cannot be written', async () => {
    const user = await createUser();
    const tag = await createTag();
    const pages = await seedSourcePages([
      { path: `${PATH_ROOT}/tag-error/a`, bodies: ['a'], tagIds: [tag] },
    ]);
    // Right before the tag write, occupy the copy's relation so the write
    // hits the relatedPage + relatedTag unique index.
    const recordProgress = async () => {
      const [copy] = await findCopiedPages(user);
      if (copy == null) return;
      await prisma.pagetagrelations.createMany({
        data: [{ relatedPageId: copy._id.toString(), relatedTagId: tag }],
      });
    };

    await expect(
      run(batchInput({ pages, user, recordProgress }, 'tag-error')),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  describe('grants', () => {
    it('keeps grant, granted users and granted groups as they are when copying everything', async () => {
      const user = await createUser();
      const ownerId = newId();
      const groupX = await createUserGroup();
      const groupY = await createUserGroup();
      const pages = await seedSourcePages([
        {
          path: `${PATH_ROOT}/grant-all/group`,
          grant: PageGrant.GRANT_USER_GROUP,
          grantedGroupIds: [groupX, groupY],
          bodies: ['group'],
        },
        {
          path: `${PATH_ROOT}/grant-all/owner`,
          grant: PageGrant.GRANT_OWNER,
          grantedUserIds: [ownerId],
          bodies: ['owner'],
        },
      ]);

      const result = await run(batchInput({ pages, user }, 'grant-all'));

      expect(result.insertedPageCount).toBe(2);
      const copies = await findCopiedPages(user);
      const groupCopy = copies.find((p) => p.path.endsWith('/group'));
      const ownerCopy = copies.find((p) => p.path.endsWith('/owner'));
      expect(groupCopy?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(
        groupCopy?.grantedGroups.map((g) => g.item.toString()).sort(),
      ).toEqual([groupX, groupY].sort());
      expect(ownerCopy?.grant).toBe(PageGrant.GRANT_OWNER);
      expect(ownerCopy?.grantedUsers?.map((u) => u.toString())).toEqual([
        ownerId,
      ]);
    });

    it('copies only the pages the user can view and keeps only the groups the user belongs to', async () => {
      const user = await createUser();
      const memberGroup = await createUserGroup(user._id.toString());
      const otherGroup = await createUserGroup();
      const pages = await seedSourcePages([
        {
          path: `${PATH_ROOT}/grant-related/shared`,
          grant: PageGrant.GRANT_USER_GROUP,
          grantedGroupIds: [memberGroup, otherGroup],
          bodies: ['shared'],
        },
        {
          path: `${PATH_ROOT}/grant-related/foreign`,
          grant: PageGrant.GRANT_USER_GROUP,
          grantedGroupIds: [otherGroup],
          bodies: ['foreign'],
        },
        { path: `${PATH_ROOT}/grant-related/public`, bodies: ['public'] },
      ]);

      const result = await run(
        batchInput(
          { pages, user, onlyDuplicateUserRelatedResources: true },
          'grant-related',
        ),
      );

      expect(result.insertedPageCount).toBe(2);
      const copies = await findCopiedPages(user);
      expect(copies.map((p) => p.path).sort()).toEqual([
        `${PATH_ROOT}/grant-related-copy/public`,
        `${PATH_ROOT}/grant-related-copy/shared`,
      ]);
      const sharedCopy = copies.find((p) => p.path.endsWith('/shared'));
      expect(sharedCopy?.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(sharedCopy?.grantedGroups.map((g) => g.item.toString())).toEqual([
        memberGroup,
      ]);
    });
  });

  describe('when recording progress fails', () => {
    it('writes nothing if it fails before the first write', async () => {
      const user = await createUser();
      const tag = await createTag();
      const pages = await seedSourcePages([
        { path: `${PATH_ROOT}/refuse-first/a`, bodies: ['a'], tagIds: [tag] },
      ]);
      const recordProgress = () => Promise.reject(new ProgressRefused());

      await expect(
        run(batchInput({ pages, user, recordProgress }, 'refuse-first')),
      ).rejects.toThrow(ProgressRefused);

      expect(await countRevisionsAuthoredBy(user)).toBe(0);
      expect(await findCopiedPages(user)).toHaveLength(0);
      expect(await countRelationsOfTag(tag)).toBe(1);
    });

    it('inserts no page and copies no tag if it fails once the revisions are copied', async () => {
      const user = await createUser();
      const tag = await createTag();
      const pages = await seedSourcePages([
        { path: `${PATH_ROOT}/refuse-pages/a`, bodies: ['a'], tagIds: [tag] },
        { path: `${PATH_ROOT}/refuse-pages/b`, bodies: ['b'] },
      ]);
      const recordProgress = async () => {
        if ((await countRevisionsAuthoredBy(user)) > 0) {
          throw new ProgressRefused();
        }
      };

      await expect(
        run(batchInput({ pages, user, recordProgress }, 'refuse-pages')),
      ).rejects.toThrow(ProgressRefused);

      expect(await countRevisionsAuthoredBy(user)).toBe(2);
      expect(await findCopiedPages(user)).toHaveLength(0);
      expect(await countRelationsOfTag(tag)).toBe(1);
    });

    it('copies no tag if it fails once the pages are inserted', async () => {
      const user = await createUser();
      const tag = await createTag();
      const pages = await seedSourcePages([
        { path: `${PATH_ROOT}/refuse-tags/a`, bodies: ['a'], tagIds: [tag] },
      ]);
      const recordProgress = async () => {
        if ((await findCopiedPages(user)).length > 0) {
          throw new ProgressRefused();
        }
      };

      await expect(
        run(batchInput({ pages, user, recordProgress }, 'refuse-tags')),
      ).rejects.toThrow(ProgressRefused);

      expect(await findCopiedPages(user)).toHaveLength(1);
      expect(await countRelationsOfTag(tag)).toBe(1);
    });
  });
});
