import type { IUserHasId } from '@growi/core';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageRedirect from '~/server/models/page-redirect';
import { prisma } from '~/utils/prisma';

import { ensurePageLinkIndexes } from '../models/page-link-indexes';
import { findForwardLinkHealth } from './find-forward-link-health';

// pagelinks is prisma-only, and the harness skips migrations on the in-memory MongoDB.
beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
});

/*
 * B5.4 — findForwardLinkHealth: a page's outbound links that need attention.
 * Contract (design.md § PageLinkService, Service Interface; requirements 5.3, 6.1–6.4, 2.1):
 * trashed and broken targets are reported, normal ones are not; a target the viewer cannot
 * read is omitted (not reported as broken); a self row is not reported.
 */
describe('findForwardLinkHealth (integration)', () => {
  const PREFIX = '/backlinks-forward-health-test';
  const TRASH_PREFIX = `/trash${PREFIX}`;

  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI; typing it precisely fights mongoose generics for no gain in a test.
  let User: any;

  let rootPage: PageDocument;
  let viewer: IUserHasId;
  let foreignUser: IUserHasId;

  // --- seeding helpers ---------------------------------------------------

  type CreatePageOptions = {
    trashed?: boolean;
    grantedTo?: IUserHasId;
    linkShared?: boolean;
  };

  const grantOf = ({ grantedTo, linkShared }: CreatePageOptions): number => {
    if (grantedTo != null) return Page.GRANT_OWNER;
    if (linkShared) return Page.GRANT_RESTRICTED;
    return Page.GRANT_PUBLIC;
  };

  // A trashed page lives under /trash, as a real soft delete leaves it.
  const createPage = (
    path: string,
    options: CreatePageOptions = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const { trashed = false, grantedTo } = options;
    return Page.create({
      path: `${trashed ? TRASH_PREFIX : PREFIX}${path}`,
      grant: grantOf(options),
      grantedUsers:
        grantedTo != null ? [new mongoose.Types.ObjectId(grantedTo._id)] : null,
      status: trashed ? Page.STATUS_DELETED : Page.STATUS_PUBLISHED,
      isEmpty: false,
      parent: rootPage._id,
    });
  };

  const addRow = (
    source: HydratedDocument<PageDocument>,
    toPath: string,
    toPage: HydratedDocument<PageDocument> | null,
  ): Promise<unknown> =>
    prisma.pagelinks.create({
      data: {
        fromPageId: source._id.toString(),
        toPath,
        toPageId: toPage?._id.toString() ?? null,
      },
    });

  const linkTo = (
    source: HydratedDocument<PageDocument>,
    target: HydratedDocument<PageDocument>,
  ): Promise<unknown> => addRow(source, target.path, target);

  const health = (source: { _id: Types.ObjectId }, user: IUserHasId | null) =>
    findForwardLinkHealth(source._id, user);

  // --- lifecycle ---------------------------------------------------------

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    const existingRoot = await Page.findOne({ path: '/' });
    rootPage =
      existingRoot ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));

    // Leftovers from an aborted run would trip the unique username/email index.
    await User.deleteMany({ username: { $in: ['flh-viewer', 'flh-foreign'] } });
    await User.insertMany([
      {
        name: 'flh-viewer',
        username: 'flh-viewer',
        email: 'flh-viewer@example.com',
      },
      {
        name: 'flh-foreign',
        username: 'flh-foreign',
        email: 'flh-foreign@example.com',
      },
    ]);
    viewer = await User.findOne({ username: 'flh-viewer' });
    foreignUser = await User.findOne({ username: 'flh-foreign' });
  });

  afterEach(async () => {
    const ownPages = { path: new RegExp(`^(${PREFIX}|${TRASH_PREFIX})/`) };
    const pages = await Page.find(ownPages).select('_id');
    await prisma.pagelinks.deleteMany({
      where: { fromPageId: { in: pages.map((p) => p._id.toString()) } },
    });
    await Page.deleteMany(ownPages);
    await PageRedirect.deleteMany({ fromPath: new RegExp(`^${PREFIX}/`) });
  });

  afterAll(async () => {
    await User.deleteMany({ username: { $in: ['flh-viewer', 'flh-foreign'] } });
  });

  // --- specs -------------------------------------------------------------

  it('reports a trashed target with its page id and current path, and not a normal one (6.1)', async () => {
    const source = await createPage('/source');
    const live = await createPage('/live');
    const trashed = await createPage('/gone-to-trash', { trashed: true });
    await linkTo(source, live);
    // The body still names the pre-trash path; the report shows where the page is now.
    await addRow(source, `${PREFIX}/gone-to-trash`, trashed);

    const result = await health(source, viewer);

    expect(result).toEqual([
      {
        pageId: trashed._id.toString(),
        path: trashed.path,
        targetState: 'trashed',
      },
    ]);
  });

  it('stops reporting a target once it is restored, with no write to the link rows (6.3)', async () => {
    const source = await createPage('/source');
    const target = await createPage('/restorable', { trashed: true });
    await linkTo(source, target);
    expect(await health(source, viewer)).toHaveLength(1);

    // Restore touches only the page; the link row is left exactly as it was.
    await Page.updateOne(
      { _id: target._id },
      { path: `${PREFIX}/restorable`, status: Page.STATUS_PUBLISHED },
    );

    expect(await health(source, viewer)).toEqual([]);
  });

  it('reports a row with no target as broken, with a null page id and its own toPath (5.3, 6.2)', async () => {
    const source = await createPage('/source');
    await addRow(source, `${PREFIX}/never-existed`, null);

    const result = await health(source, viewer);

    expect(result).toEqual([
      {
        pageId: null,
        path: `${PREFIX}/never-existed`,
        targetState: 'broken',
      },
    ]);
  });

  it('omits a trashed target the viewer cannot read, rather than reporting it as broken (2.1)', async () => {
    const source = await createPage('/source');
    const restricted = await createPage('/restricted', {
      trashed: true,
      grantedTo: foreignUser,
    });
    await linkTo(source, restricted);

    const asViewer = await health(source, viewer);
    const asGuest = await health(source, null);

    // Neither its path nor its existence may leak — so not even a broken entry.
    expect(asViewer).toEqual([]);
    expect(asGuest).toEqual([]);

    // Positive control: the owner sees it, so the omission above is the grant filter's
    // doing, not a missing row.
    const asOwner = await health(source, foreignUser);
    expect(asOwner).toEqual([
      {
        pageId: restricted._id.toString(),
        path: restricted.path,
        targetState: 'trashed',
      },
    ]);
  });

  it('reports a trashed "anyone with the link" target, since the viewer holds the link', async () => {
    const source = await createPage('/source');
    const linkShared = await createPage('/link-shared', {
      trashed: true,
      linkShared: true,
    });
    await linkTo(source, linkShared);

    const result = await health(source, viewer);

    expect(result).toEqual([
      {
        pageId: linkShared._id.toString(),
        path: linkShared.path,
        targetState: 'trashed',
      },
    ]);
  });

  it('does not report a self row as broken, whether it names the source directly or via a redirect', async () => {
    const source = await createPage('/source');
    // repointInboundLinks leaves a self row with no target; a path redirecting into the
    // source (left by a rename) is cleared the same way.
    await addRow(source, source.path, null);
    await PageRedirect.create({
      fromPath: `${PREFIX}/source-old-name`,
      toPath: source.path,
    });
    await addRow(source, `${PREFIX}/source-old-name`, null);
    // Positive control: a genuinely broken row next to them is still reported.
    await addRow(source, `${PREFIX}/never-existed`, null);

    const result = await health(source, viewer);

    expect(result).toEqual([
      {
        pageId: null,
        path: `${PREFIX}/never-existed`,
        targetState: 'broken',
      },
    ]);
  });

  it('reports a trashed target once when the body links to it by two spellings', async () => {
    const source = await createPage('/source');
    const trashed = await createPage('/gone-to-trash', { trashed: true });
    await linkTo(source, trashed);
    await addRow(source, `/${trashed._id.toString()}`, trashed);

    const result = await health(source, viewer);

    expect(result).toEqual([
      {
        pageId: trashed._id.toString(),
        path: trashed.path,
        targetState: 'trashed',
      },
    ]);
  });

  it('reports trashed and broken targets together', async () => {
    const source = await createPage('/source');
    const trashed = await createPage('/gone-to-trash', { trashed: true });
    await linkTo(source, trashed);
    await addRow(source, `${PREFIX}/never-existed`, null);

    const result = await health(source, viewer);

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          pageId: trashed._id.toString(),
          path: trashed.path,
          targetState: 'trashed',
        },
        {
          pageId: null,
          path: `${PREFIX}/never-existed`,
          targetState: 'broken',
        },
      ]),
    );
  });

  it('returns an empty array when the page has no outbound links', async () => {
    const source = await createPage('/source');

    const result = await health(source, viewer);

    expect(result).toEqual([]);
  });
});
