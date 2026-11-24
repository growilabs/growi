import { EventEmitter } from 'node:events';
import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

import {
  type AncestorUpdate,
  runDuplicateSubOperation,
  type SubOperationInput,
} from './run-duplicate-sub-operation';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/run-duplicate-sub-operation-integ-${WORKER_ID}`;
const USERNAME = `run-duplicate-sub-operation-integ-${WORKER_ID}`;

class OwnershipLost extends Error {}

describe('runDuplicateSubOperation', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let user: HydratedDocument<IUserHasId>;
  let rootId: Types.ObjectId;

  const createPage = (
    path: string,
    overrides: Partial<PageDocument> = {},
  ): Promise<HydratedDocument<PageDocument>> =>
    Page.create({
      path,
      grant: PageGrant.GRANT_PUBLIC,
      creator: user._id,
      ...overrides,
    });

  // Ancestors A > B are on the tree and already counted correctly. The copy pages
  // are orphans (parent null), as copyDescendantBatch leaves them.
  //   A/B/copy (top), A/B/copy/x, A/B/copy/x/y, A/B/copy/e (empty)
  const seedCase = async (name: string) => {
    const aPath = `${PATH_ROOT}/${name}`;
    const bPath = `${aPath}/b`;
    const toPath = `${bPath}/copy`;
    const a = await createPage(aPath, { parent: rootId, descendantCount: 1 });
    const b = await createPage(bPath, { parent: a._id, descendantCount: 0 });
    const top = await createPage(toPath);
    await createPage(`${toPath}/x`);
    await createPage(`${toPath}/x/y`);
    await createPage(`${toPath}/e`, { isEmpty: true });
    return { a, b, top, toPath, aPath, bPath };
  };

  const findByPath = (path: string) => Page.findOne({ path }).lean();

  const run = (
    toPath: string,
    ancestorUpdate: AncestorUpdate,
    overrides: Partial<SubOperationInput> = {},
    pageEvent: EventEmitter = new EventEmitter(),
  ) =>
    runDuplicateSubOperation(
      { pageService: crowi.pageService, pageEvent },
      {
        toPath,
        userId: user._id.toString(),
        shouldNormalizeParent: true,
        ancestorUpdate,
        onBatchStart: async () => {},
        ...overrides,
      },
    );

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await crowi.models.User.deleteMany({ username: USERNAME });
    user = await crowi.models.User.create({
      name: USERNAME,
      username: USERNAME,
      email: `${USERNAME}@example.com`,
    });
    const root =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootId = root._id;
  }, 60_000);

  afterAll(async () => {
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await crowi.models.User.deleteMany({ _id: user._id });
  });

  describe.each([
    {
      mode: 'success (increment)',
      name: 'inc',
      // Ancestors are stale by exactly the inserted count
      ancestorUpdate: { kind: 'increment', insertedPageCount: 3 } as const,
      staleAncestors: false,
    },
    {
      mode: 'recovery (recount)',
      name: 'rec',
      ancestorUpdate: { kind: 'recount' } as const,
      staleAncestors: true,
    },
  ])('$mode', ({ name, ancestorUpdate, staleAncestors }) => {
    it('attaches the orphan copy to the page tree', async () => {
      const { toPath, bPath, b } = await seedCase(name);
      if (staleAncestors) {
        await Page.updateMany(
          { path: { $in: [bPath, `${PATH_ROOT}/${name}`] } },
          { descendantCount: 99 },
        );
      }

      await run(toPath, ancestorUpdate);

      const top = await findByPath(toPath);
      const x = await findByPath(`${toPath}/x`);
      const y = await findByPath(`${toPath}/x/y`);
      expect(top?.parent?.toString()).toBe(b._id.toString());
      expect(x?.parent?.toString()).toBe(top?._id.toString());
      expect(y?.parent?.toString()).toBe(x?._id.toString());
    });

    it('makes the copy and its ancestors report the real descendant counts', async () => {
      const { toPath, bPath, aPath } = await seedCase(`${name}-count`);
      if (staleAncestors) {
        await Page.updateMany(
          { path: { $in: [bPath, aPath] } },
          { descendantCount: 99 },
        );
      }

      await run(toPath, ancestorUpdate);

      // copy: x and y (the empty page does not count); x: y
      expect((await findByPath(toPath))?.descendantCount).toBe(2);
      expect((await findByPath(`${toPath}/x`))?.descendantCount).toBe(1);
      expect((await findByPath(`${toPath}/x/y`))?.descendantCount).toBe(0);
      // B holds the copy top and its 2 descendants; A holds B and those 3
      expect((await findByPath(bPath))?.descendantCount).toBe(3);
      expect((await findByPath(aPath))?.descendantCount).toBe(4);
    });
  });

  it('adds the inserted count to the stored ancestor counts instead of recounting', async () => {
    const { toPath, aPath, bPath } = await seedCase('increment-adds');
    // A holds 10 pages that a concurrent operation has already counted; the
    // inserted count (2) also differs from the real copy size (3).
    await Page.updateOne({ path: bPath }, { descendantCount: 1 });
    await Page.updateOne({ path: aPath }, { descendantCount: 12 });

    await run(toPath, { kind: 'increment', insertedPageCount: 2 });

    expect((await findByPath(bPath))?.descendantCount).toBe(3);
    expect((await findByPath(aPath))?.descendantCount).toBe(14);
  });

  it('attaches the copy to an owner-granted existing parent without creating a duplicate page', async () => {
    // The grant condition behind the parent lookup reads user._id: a bare user
    // id string would hide the user's own page and a second page would appear
    // at the same path.
    const aPath = `${PATH_ROOT}/owner`;
    const midPath = `${aPath}/mid`;
    const toPath = `${midPath}/copy`;
    const a = await createPage(aPath, { parent: rootId });
    const mid = await createPage(midPath, {
      parent: a._id,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [user._id],
    });
    await createPage(toPath, {
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [user._id],
    });

    await run(toPath, { kind: 'recount' });

    expect(await Page.countDocuments({ path: midPath })).toBe(1);
    expect((await findByPath(toPath))?.parent?.toString()).toBe(
      mid._id.toString(),
    );
  });

  it('creates an empty page for a missing intermediate parent of the copy', async () => {
    const aPath = `${PATH_ROOT}/missing-mid`;
    const midPath = `${aPath}/mid`;
    const toPath = `${midPath}/copy`;
    const a = await createPage(aPath, { parent: rootId });
    await createPage(toPath);

    await run(toPath, { kind: 'recount' });

    const mid = await findByPath(midPath);
    expect(mid?.isEmpty).toBe(true);
    expect(mid?.parent?.toString()).toBe(a._id.toString());
    expect((await findByPath(toPath))?.parent?.toString()).toBe(
      mid?._id.toString(),
    );
  });

  it('leaves the parent untouched when shouldNormalizeParent is false', async () => {
    const { toPath } = await seedCase('no-normalize');

    await run(toPath, { kind: 'recount' }, { shouldNormalizeParent: false });

    expect((await findByPath(toPath))?.parent).toBeNull();
    expect((await findByPath(`${toPath}/x`))?.parent).toBeNull();
  });

  it('emits syncDescendantsUpdate once, with the copy top page', async () => {
    const { toPath, top } = await seedCase('event');
    const pageEvent = new EventEmitter();
    const listener = vi.fn();
    pageEvent.on('syncDescendantsUpdate', listener);

    await run(toPath, { kind: 'recount' }, {}, pageEvent);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]._id.toString()).toBe(top._id.toString());
    expect(listener.mock.calls[0][0].path).toBe(toPath);
  });

  it('returns the number of non-empty pages under the copy, top page included', async () => {
    const { toPath } = await seedCase('count');
    // Pages that share only a name prefix with the copy are not part of it
    await createPage(`${toPath}-sibling`);
    await createPage(`${toPath}-sibling/z`);

    const result = await run(toPath, { kind: 'recount' });

    expect(result).toEqual({ copiedPageCount: 3 });
  });

  it('does not treat regex metacharacters in the path as a pattern', async () => {
    const aPath = `${PATH_ROOT}/meta`;
    await createPage(aPath, { parent: rootId });
    const toPath = `${aPath}/c(+)`;
    await createPage(toPath);
    await createPage(`${toPath}/child`);
    // Would match "c(+)" as a regex prefix if the path were not escaped
    await createPage(`${aPath}/cc/other`);

    const result = await run(toPath, { kind: 'recount' });

    expect(result).toEqual({ copiedPageCount: 2 });
  });

  describe('when onBatchStart throws', () => {
    it('aborts before attaching the copy and before later steps', async () => {
      const { toPath, aPath, bPath } = await seedCase('abort-normalize');
      const pageEvent = new EventEmitter();
      const listener = vi.fn();
      pageEvent.on('syncDescendantsUpdate', listener);

      await expect(
        run(
          toPath,
          { kind: 'increment', insertedPageCount: 3 },
          {
            onBatchStart: () => Promise.reject(new OwnershipLost()),
          },
          pageEvent,
        ),
      ).rejects.toBeInstanceOf(OwnershipLost);

      expect((await findByPath(toPath))?.parent).toBeNull();
      expect((await findByPath(bPath))?.descendantCount).toBe(0);
      expect((await findByPath(aPath))?.descendantCount).toBe(1);
      expect(listener).not.toHaveBeenCalled();
    });

    it('aborts the own-subtree recount before the copy reports its count', async () => {
      const { toPath, aPath, bPath } = await seedCase('abort-own-recount');
      const pageEvent = new EventEmitter();
      const listener = vi.fn();
      pageEvent.on('syncDescendantsUpdate', listener);
      // The copy is attached once the normalize is done, so the next call is
      // the one right before the own-subtree recount.
      const onBatchStart = async () => {
        const top = await findByPath(toPath);
        if (top?.parent != null) {
          throw new OwnershipLost();
        }
      };

      await expect(
        run(
          toPath,
          { kind: 'increment', insertedPageCount: 3 },
          { onBatchStart },
          pageEvent,
        ),
      ).rejects.toBeInstanceOf(OwnershipLost);

      expect((await findByPath(toPath))?.descendantCount).toBe(0);
      expect((await findByPath(bPath))?.descendantCount).toBe(0);
      expect((await findByPath(aPath))?.descendantCount).toBe(1);
      expect(listener).not.toHaveBeenCalled();
    });

    it('aborts the increment before the ancestors are modified and before the event', async () => {
      const { toPath, aPath, bPath } = await seedCase('abort-increment');
      const pageEvent = new EventEmitter();
      const listener = vi.fn();
      pageEvent.on('syncDescendantsUpdate', listener);
      // The own-subtree recount is done once the copy top reports its count, so
      // the next call is the one right before the ancestor increment.
      const onBatchStart = async () => {
        const top = await findByPath(toPath);
        if (top?.descendantCount === 2) {
          throw new OwnershipLost();
        }
      };

      await expect(
        run(
          toPath,
          { kind: 'increment', insertedPageCount: 3 },
          { onBatchStart },
          pageEvent,
        ),
      ).rejects.toBeInstanceOf(OwnershipLost);

      expect((await findByPath(bPath))?.descendantCount).toBe(0);
      expect((await findByPath(aPath))?.descendantCount).toBe(1);
      expect(listener).not.toHaveBeenCalled();
    });

    it('aborts the recount before the ancestors are fixed and before the event', async () => {
      const { toPath, aPath, bPath } = await seedCase('abort-recount');
      await Page.updateMany(
        { path: { $in: [aPath, bPath] } },
        { descendantCount: 99 },
      );
      const pageEvent = new EventEmitter();
      const listener = vi.fn();
      pageEvent.on('syncDescendantsUpdate', listener);
      // The own-subtree recount is done once the copy top reports its count, so
      // the next call is the one right before the ancestor recount.
      const onBatchStart = async () => {
        const top = await findByPath(toPath);
        if (top?.descendantCount === 2) {
          throw new OwnershipLost();
        }
      };

      await expect(
        run(toPath, { kind: 'recount' }, { onBatchStart }, pageEvent),
      ).rejects.toBeInstanceOf(OwnershipLost);

      expect((await findByPath(bPath))?.descendantCount).toBe(99);
      expect((await findByPath(aPath))?.descendantCount).toBe(99);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
