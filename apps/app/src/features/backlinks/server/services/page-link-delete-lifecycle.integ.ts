import type { IUserHasId } from '@growi/core';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import { prisma } from '~/utils/prisma';

import { ensurePageLinkIndexes } from '../models/page-link-indexes';
import { findUserGroupIdsForViewer } from './find-user-group-ids-for-viewer';

// pagelinks is prisma-only, and the harness skips migrations on the in-memory MongoDB.
beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
});

/*
 * B5.8 — trash / permanent delete / restore, driven through the real
 * crowi.pageService so the page events PageLinkService subscribes to actually fire
 * (requirements 3.3, 6.1, 6.2, 6.3). A hand-written status or path update emits no
 * event, so it could never catch a broken subscription or a wrong event payload.
 *
 * Recursive operations run a detached sub-operation that outlives the call, so the one
 * recursive spec waits for its PageOperation to clear before it asserts or ends.
 */
const WAIT_OPTIONS = { timeout: 15_000, interval: 100 };

// Twice the waitFor window, so a regression fails with the assertion message instead of
// a bare test timeout.
describe('Backlinks B5.8 (delete-family lifecycle integration)', {
  timeout: WAIT_OPTIONS.timeout * 2,
}, () => {
  const PREFIX = '/backlinks-b58-delete-lifecycle-test';
  // Sentinel ip so cleanup deletes only this suite's activity rows.
  const TEST_IP = '10.0.0.82';
  const activityParameters = {
    ip: TEST_IP,
    endpoint: '/_api/v3/pages/delete',
  };

  let crowi: Crowi;
  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI; typing it precisely fights mongoose generics for no gain in a test.
  let User: any;

  let rootPage: PageDocument;
  let viewer: IUserHasId;

  // --- helpers -----------------------------------------------------------

  const createPage = (
    path: string,
    parent?: Types.ObjectId,
  ): Promise<HydratedDocument<PageDocument>> =>
    Page.create({
      path: `${PREFIX}${path}`,
      grant: Page.GRANT_PUBLIC,
      grantedUsers: null,
      isEmpty: false,
      parent: parent ?? rootPage._id,
    });

  const readBacklinks = async (toPageId: Types.ObjectId) =>
    crowi.pageLinkService.findBacklinks(
      toPageId,
      viewer,
      await findUserGroupIdsForViewer(viewer),
    );

  const readHealth = async (fromPageId: Types.ObjectId) =>
    crowi.pageLinkService.findForwardLinkHealth(
      fromPageId,
      viewer,
      await findUserGroupIdsForViewer(viewer),
    );

  // Full row, identity included, for a byte-for-byte "never written" comparison.
  // Columns are selected explicitly: see the note on outboundRow in
  // page-link-lifecycle.integ.ts about the client-wide `_id`/`__v` compute aliases.
  const outboundRow = (fromPage: Types.ObjectId) =>
    prisma.pagelinks.findFirst({
      where: { fromPageId: fromPage.toString() },
      select: { id: true, fromPageId: true, toPath: true, toPageId: true },
    });

  const waitForOutboundCount = (
    fromPage: Types.ObjectId,
    count: number,
  ): Promise<void> =>
    vi.waitFor(async () => {
      expect(
        await prisma.pagelinks.count({
          where: { fromPageId: fromPage.toString() },
        }),
      ).toBe(count);
    }, WAIT_OPTIONS);

  // `removeLinksForPages` clears this cache; the derived "broken" report alone cannot show
  // that a delete event reached the reconcile, since a missing page already reads as broken.
  const waitForInboundCacheCleared = (
    fromPage: Types.ObjectId,
  ): Promise<void> =>
    vi.waitFor(async () => {
      expect((await outboundRow(fromPage))?.toPageId).toBeNull();
    }, WAIT_OPTIONS);

  // Create a target, then a source linking to it, and wait until the link row exists.
  // The target comes first so the link resolves to it instead of being recorded broken.
  const createLinkedPair = async (
    targetPath = '/target',
    targetParent?: Types.ObjectId,
  ) => {
    const target = await createPage(targetPath, targetParent);
    const source = await createPage('/source');

    const revision = await prisma.revisions.create({
      data: {
        pageId: source._id.toString(),
        body: `[to target](${target.path})`,
      },
    });
    const revisionId = new mongoose.Types.ObjectId(revision.id);
    source.revision = revisionId;
    await Page.updateOne({ _id: source._id }, { revision: revisionId });
    crowi.events.page.emit('create', source);
    await waitForOutboundCount(source._id, 1);

    return { source, target };
  };

  // A recursive delete does not await its sub-operation; wait until it deletes its
  // PageOperation, or it outlives the spec and hits the worker's disconnect.
  const waitForOperationSettled = (fromPath: string): Promise<void> =>
    vi.waitFor(async () => {
      expect(await PageOperation.findOne({ fromPath })).toBeNull();
    }, WAIT_OPTIONS);

  // --- lifecycle ---------------------------------------------------------

  beforeAll(async () => {
    crowi = await getInstance();
    // A fresh test crowi defaults this to false, which would route the real
    // delete/revert calls through the legacy V4 branch instead.
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    const existingRoot = await Page.findOne({ path: '/' });
    rootPage =
      existingRoot ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));

    await User.insertMany([
      {
        name: 'b58-viewer',
        username: 'b58-viewer',
        email: 'b58-viewer@example.com',
      },
    ]);
    viewer = await User.findOne({ username: 'b58-viewer' });
  });

  afterEach(async () => {
    // Matches /trash… too, and the bare PREFIX: a real revert fills in the missing
    // ancestor as an empty page.
    const seededPaths = new RegExp(`^(/trash)?${PREFIX}(/|$)`);
    const pages = await Page.find({ path: seededPaths }).select('_id');
    const ids = pages.map((p) => p._id.toString());
    await prisma.pagelinks.deleteMany({ where: { fromPageId: { in: ids } } });
    await prisma.revisions.deleteMany({ where: { pageId: { in: ids } } });
    await Page.deleteMany({ path: seededPaths });
    await prisma.pageredirects.deleteMany({
      where: {
        OR: [
          { fromPath: { startsWith: `${PREFIX}/` } },
          { fromPath: { startsWith: `/trash${PREFIX}/` } },
        ],
      },
    });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    // A PageOperation left by a failed recursive spec would lock its path and make every
    // later create there fail with "Cannot process create".
    await PageOperation.deleteMany({ fromPath: seededPaths });
  });

  afterAll(async () => {
    await User.deleteMany({ username: { $in: ['b58-viewer'] } });
  });

  // --- specs -------------------------------------------------------------

  it('keeps the link when its target is trashed, and reports the target as trashed (6.1)', async () => {
    const { source, target } = await createLinkedPair();
    const before = await outboundRow(source._id);
    expect(before?.toPageId).toBe(target._id.toString());
    expect(await readHealth(source._id)).toEqual([]);

    const trashedTarget = await crowi.pageService.deletePage(
      target,
      viewer,
      {},
      false,
      activityParameters,
    );

    expect(await readHealth(source._id)).toEqual([
      {
        pageId: target._id.toString(),
        path: trashedTarget.path,
        targetState: 'trashed',
      },
    ]);
    expect(await outboundRow(source._id)).toEqual(before);
  });

  it('marks the link broken when its target is permanently deleted (6.2)', async () => {
    const { source, target } = await createLinkedPair();
    const before = await outboundRow(source._id);
    expect(before?.toPageId).toBe(target._id.toString());

    await crowi.pageService.deleteCompletely(
      target,
      viewer,
      {},
      false,
      false,
      activityParameters,
    );

    await waitForInboundCacheCleared(source._id);

    expect(await readHealth(source._id)).toEqual([
      { pageId: null, path: target.path, targetState: 'broken' },
    ]);
  });

  it('returns the link to normal when its trashed target is restored, with no write to the row (6.3)', async () => {
    const { source, target } = await createLinkedPair();
    const before = await outboundRow(source._id);

    const trashedTarget = await crowi.pageService.deletePage(
      target,
      viewer,
      {},
      false,
      activityParameters,
    );
    // Guard: without this, an empty report after the restore could just mean the
    // trash never took effect. Pinned to `trashed`, since any entry would satisfy a count.
    expect(await readHealth(source._id)).toEqual([
      expect.objectContaining({ targetState: 'trashed' }),
    ]);

    await crowi.pageService.revertDeletedPage(
      trashedTarget,
      viewer,
      {},
      false,
      activityParameters,
    );
    expect((await Page.findOne({ _id: target._id }))?.path).toBe(target.path);

    expect(await readHealth(source._id)).toEqual([]);
    // Unchanged row plus a listed backlink: the relationship survived the whole
    // trash and restore, rather than being dropped and the report merely empty.
    expect(await outboundRow(source._id)).toEqual(before);
    expect(await readBacklinks(target._id)).toEqual([
      { pageId: source._id.toString(), path: source.path },
    ]);
  });

  it('stops listing a permanently deleted source as a backlink, and removes its rows (3.3)', async () => {
    const { source, target } = await createLinkedPair();
    expect(await readBacklinks(target._id)).toEqual([
      { pageId: source._id.toString(), path: source.path },
    ]);

    await crowi.pageService.deleteCompletely(
      source,
      viewer,
      {},
      false,
      false,
      activityParameters,
    );

    // The row count is the signal that the event reached the reconcile; the backlink
    // read alone would also come back empty from the missing source page.
    await waitForOutboundCount(source._id, 0);
    expect(await readBacklinks(target._id)).toEqual([]);
  });

  it('marks the link broken when its target is permanently deleted along with an ancestor (6.2)', async () => {
    const ancestor = await createPage('/ancestor');
    // Only a descendant of the deleted page: the ancestor's own deleteCompletely event
    // carries no link to this target, so only syncDescendantsDelete can break the row.
    const { source, target } = await createLinkedPair(
      '/ancestor/target',
      ancestor._id,
    );
    const before = await outboundRow(source._id);
    expect(before?.toPageId).toBe(target._id.toString());

    await crowi.pageService.deleteCompletely(
      ancestor,
      viewer,
      {},
      true,
      false,
      activityParameters,
    );
    await waitForOperationSettled(ancestor.path);

    // syncDescendantsDelete hands the reconcile an array, unlike the single-page events,
    // so a handler reading it as one document would silently settle nothing.
    await waitForInboundCacheCleared(source._id);
    expect(await readHealth(source._id)).toEqual([
      { pageId: null, path: target.path, targetState: 'broken' },
    ]);
  });
});
