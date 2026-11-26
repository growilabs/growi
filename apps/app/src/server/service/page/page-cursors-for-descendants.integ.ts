import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';

import { BULK_REINDEX_SIZE } from './consts';
import { PageCursorsForDescendantsFactory } from './page-cursors-for-descendants';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/page-cursors-for-descendants-integ-${WORKER_ID}`;

// More children than one cursor batch holds, so the server keeps the cursor open.
const CHILD_COUNT = BULK_REINDEX_SIZE + 1;

class ConsumerFailed extends Error {}

describe('PageCursorsForDescendantsFactory', () => {
  let Page: PageModel;
  let top: HydratedDocument<PageDocument>;

  // Idle cursors on this worker's own database, so other workers sharing an
  // external MongoDB do not affect the count.
  const countOpenPageCursors = async (): Promise<number> => {
    const { db } = mongoose.connection;
    const cursors = await mongoose.connection
      .getClient()
      .db('admin')
      .aggregate([
        { $currentOp: { idleCursors: true } },
        { $match: { type: 'idleCursor', ns: `${db.databaseName}.pages` } },
      ])
      .toArray();
    return cursors.length;
  };

  const childrenOf = (parent: Types.ObjectId, parentPath: string) =>
    Array.from({ length: CHILD_COUNT }, (_, i) => ({
      _id: new Types.ObjectId(),
      path: `${parentPath}/c${String(i).padStart(3, '0')}`,
      parent,
      grant: PageGrant.GRANT_PUBLIC,
    }));

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}(/|$)` } });

    top = await Page.create({ path: PATH_ROOT, grant: PageGrant.GRANT_PUBLIC });
    const children = childrenOf(top._id, PATH_ROOT);
    // Inserted first so that it is read first: its own children are then
    // yielded while the cursor over top's children is still open.
    const [first, ...rest] = children;
    await Page.insertMany([first]);
    await Page.insertMany(childrenOf(first._id, first.path));
    await Page.insertMany(rest);
  });

  afterAll(async () => {
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}(/|$)` } });
  });

  it('closes every cursor it opened when the consumer stops early', async () => {
    const before = await countOpenPageCursors();
    let openWhileReading = 0;

    const descendants = await new PageCursorsForDescendantsFactory(
      null,
      top,
      true,
    ).generateIterable();
    for await (const _page of descendants) {
      openWhileReading = await countOpenPageCursors();
      break;
    }

    // the cursors over top's children and over its first child's children
    expect(openWhileReading).toBe(before + 2);
    expect(await countOpenPageCursors()).toBe(before);
  });

  it('closes every cursor it opened when the consumer throws', async () => {
    const before = await countOpenPageCursors();
    let openWhileReading = 0;

    const descendants = await new PageCursorsForDescendantsFactory(
      null,
      top,
      true,
    ).generateIterable();
    const consume = async () => {
      for await (const _page of descendants) {
        openWhileReading = await countOpenPageCursors();
        throw new ConsumerFailed();
      }
    };

    await expect(consume()).rejects.toThrow(ConsumerFailed);
    expect(openWhileReading).toBe(before + 2);
    expect(await countOpenPageCursors()).toBe(before);
  });

  it('still yields every descendant when read to the end', async () => {
    const descendants = await new PageCursorsForDescendantsFactory(
      null,
      top,
      true,
    ).generateIterable();
    const paths: string[] = [];
    for await (const page of descendants) {
      paths.push(page.path);
    }

    expect(paths).toHaveLength(CHILD_COUNT * 2);
    expect(new Set(paths).size).toBe(CHILD_COUNT * 2);
  });
});
