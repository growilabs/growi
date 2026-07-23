import type { IUserHasId } from '@growi/core';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import PageLink from '../models/page-link';

/*
 * B1.15 — Integration tests for the B1 slice.
 *
 * Exercises the whole vertical slice through the WIRED service: a create/update
 * lifecycle event (emitted exactly as PageService does) drives the real
 * extraction -> resolution -> outbound-row sync, and the permission-filtered
 * read (findBacklinks) reflects the result. Unlike page-link-service-handlers.integ
 * (which mocks resolveToPages) and page-link-service.integ (which seeds rows by
 * hand), nothing here is mocked — the pageLinkService created by setupPageService
 * is the object under test, and target pages are real so resolution runs for real.
 *
 * Covers (requirements 1.6, 2.1-2.4, 3.1, 3.2):
 *  - create adds backlinks; a later update removes them
 *  - a source the viewer cannot read is excluded; a grant change is reflected on re-read
 *  - a source linking B->A more than once is listed once
 *  - a page linking to its own permalink is excluded from its own backlinks
 *
 * B1 scope: rename/move (B4.4) and trash/delete/restore (B5.8) are out of scope.
 */
describe('Backlinks B1 slice (lifecycle integration)', () => {
  const PREFIX = '/backlinks-b1-lifecycle-test';

  let crowi: Crowi;
  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI; typing it precisely fights mongoose generics for no gain in a test.
  let User: any;

  let rootPage: PageDocument;

  let viewer: IUserHasId; // the querying user
  let foreignUser: IUserHasId; // a different user; owner of the restricted sources

  // --- seeding helpers ---------------------------------------------------

  type CreatePageOptions = {
    grant?: number;
    grantedUsers?: Types.ObjectId[] | null;
  };

  const createPage = (
    path: string,
    options: CreatePageOptions = {},
  ): Promise<HydratedDocument<PageDocument>> =>
    Page.create({
      path: `${PREFIX}${path}`,
      grant: options.grant ?? Page.GRANT_PUBLIC,
      grantedUsers: options.grantedUsers ?? null,
      isEmpty: false,
      parent: rootPage._id,
    });

  // Attach a body via a fresh revision, then emit the lifecycle event exactly as
  // PageService does. The handler reads the body from the latest revision, so the
  // revision reference is left unpopulated (an ObjectId) on purpose.
  const emitUpsert = async (
    event: 'create' | 'update',
    page: HydratedDocument<PageDocument>,
    body: string,
  ): Promise<void> => {
    const revision = await Revision.create({ pageId: page._id, body });
    // Assign the ObjectId directly: this mirrors the unpopulated-revision path
    // and avoids relying on populate() in the test.
    page.revision = revision._id;
    crowi.events.page.emit(event, page);
  };

  const outboundRows = (fromPage: Types.ObjectId) =>
    PageLink.find({ fromPage })
      .select('toPath toPage -_id')
      .sort({ toPath: 1 })
      .lean();

  // The service handles create/update asynchronously (fire-and-forget from the
  // emitter's view). Poll the outbound-row count — the observable write-path
  // result — until it settles to the expected value, then assert precisely.
  const waitForOutboundCount = (
    fromPage: Types.ObjectId,
    count: number,
  ): Promise<void> =>
    vi.waitFor(
      async () => {
        expect(await PageLink.countDocuments({ fromPage })).toBe(count);
      },
      { timeout: 15000, interval: 100 },
    );

  // --- lifecycle ---------------------------------------------------------

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    const existingRoot = await Page.findOne({ path: '/' });
    rootPage =
      existingRoot ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));

    await User.insertMany([
      {
        name: 'b1lc-viewer',
        username: 'b1lc-viewer',
        email: 'b1lc-viewer@example.com',
      },
      {
        name: 'b1lc-foreign',
        username: 'b1lc-foreign',
        email: 'b1lc-foreign@example.com',
      },
    ]);
    viewer = await User.findOne({ username: 'b1lc-viewer' });
    foreignUser = await User.findOne({ username: 'b1lc-foreign' });
  });

  afterEach(async () => {
    const pages = await Page.find({ path: new RegExp(`^${PREFIX}/`) }).select(
      '_id',
    );
    const ids = pages.map((p) => p._id);
    await PageLink.deleteMany({ fromPage: { $in: ids } });
    await Revision.deleteMany({ pageId: { $in: ids } });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
  });

  afterAll(async () => {
    await User.deleteMany({
      username: { $in: ['b1lc-viewer', 'b1lc-foreign'] },
    });
  });

  // --- specs -------------------------------------------------------------

  it('create adds a backlink, and a later update removes it (3.1, 3.2)', async () => {
    const target = await createPage('/target');
    const source = await createPage('/source');

    // Create: the source links to the target.
    await emitUpsert('create', source, `[to target](${target.path})`);
    await waitForOutboundCount(source._id, 1);

    expect(
      await crowi.pageLinkService.findBacklinks(target._id, viewer),
    ).toEqual([{ pageId: source._id.toString(), path: source.path }]);

    // Update: the link is removed from the body.
    await emitUpsert('update', source, 'no links anymore');
    await waitForOutboundCount(source._id, 0);

    expect(
      await crowi.pageLinkService.findBacklinks(target._id, viewer),
    ).toEqual([]);
  });

  it('excludes a source the viewer cannot read, but the owner sees it (2.1, 2.2, 2.3)', async () => {
    const target = await createPage('/target');
    const readable = await createPage('/readable');
    const restricted = await createPage('/restricted', {
      grant: Page.GRANT_OWNER,
      grantedUsers: [new mongoose.Types.ObjectId(foreignUser._id)],
    });

    await emitUpsert('create', readable, `[t](${target.path})`);
    await emitUpsert('create', restricted, `[t](${target.path})`);
    await waitForOutboundCount(readable._id, 1);
    await waitForOutboundCount(restricted._id, 1);

    // The restricted source must not leak — neither its path nor its existence.
    expect(
      await crowi.pageLinkService.findBacklinks(target._id, viewer),
    ).toEqual([{ pageId: readable._id.toString(), path: readable.path }]);

    // Positive control: the owner sees it, so the omission above is the grant
    // filter's doing, not a missing row.
    expect(
      await crowi.pageLinkService.findBacklinks(target._id, foreignUser),
    ).toEqual(
      expect.arrayContaining([
        { pageId: restricted._id.toString(), path: restricted.path },
      ]),
    );
  });

  it('reflects a grant change on the next read (2.4)', async () => {
    const target = await createPage('/target');
    const source = await createPage('/flipping-source');

    await emitUpsert('create', source, `[t](${target.path})`);
    await waitForOutboundCount(source._id, 1);

    expect(
      await crowi.pageLinkService.findBacklinks(target._id, viewer),
    ).toHaveLength(1);

    // Restrict the source to the foreign user; the row is unchanged but the
    // read must now filter it out.
    await Page.updateOne(
      { _id: source._id },
      {
        grant: Page.GRANT_OWNER,
        grantedUsers: [new mongoose.Types.ObjectId(foreignUser._id)],
      },
    );

    expect(
      await crowi.pageLinkService.findBacklinks(target._id, viewer),
    ).toEqual([]);

    // Positive control: the row survived the grant change and is filtered by the
    // read, not deleted — the new owner still sees the backlink.
    expect(
      await crowi.pageLinkService.findBacklinks(target._id, foreignUser),
    ).toEqual([{ pageId: source._id.toString(), path: source.path }]);
  });

  it('lists a source once even when it links to the target more than once (1.6)', async () => {
    const target = await createPage('/target');
    const source = await createPage('/multi-source');

    await emitUpsert(
      'create',
      source,
      `[first](${target.path}) and again [second](${target.path})`,
    );
    // The repeated link collapses to a single outbound row.
    await waitForOutboundCount(source._id, 1);
    expect(await outboundRows(source._id)).toEqual([
      { toPath: target.path, toPage: target._id },
    ]);

    // And the read lists the source exactly once.
    expect(
      await crowi.pageLinkService.findBacklinks(target._id, viewer),
    ).toEqual([{ pageId: source._id.toString(), path: source.path }]);
  });

  it('excludes a page linking to its own permalink from its own backlinks (1.6)', async () => {
    const other = await createPage('/other');
    const selfLinker = await createPage('/self-linker');

    // The page links to its own permalink (/{id}) and to another page. The
    // self-permalink row resolves back to the source and is dropped at sync;
    // the link to /other survives.
    await emitUpsert(
      'create',
      selfLinker,
      `[myself](/${selfLinker._id.toString()}) [other](${other.path})`,
    );
    await waitForOutboundCount(selfLinker._id, 1);

    // Only the non-self link remains as an outbound row.
    expect(await outboundRows(selfLinker._id)).toEqual([
      { toPath: other.path, toPage: other._id },
    ]);

    // The page is not a backlink of itself.
    expect(
      await crowi.pageLinkService.findBacklinks(selfLinker._id, viewer),
    ).toEqual([]);

    // Positive control: the surviving link is recorded — /other lists the page.
    expect(
      await crowi.pageLinkService.findBacklinks(other._id, viewer),
    ).toEqual([{ pageId: selfLinker._id.toString(), path: selfLinker.path }]);
  });
});
