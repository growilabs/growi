import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import PageRedirect from '~/server/models/page-redirect';

import type { IPageLink } from '../../interfaces/page-link';
import PageLink from '../models/page-link';
import { reResolveByToPath, syncOutboundLinks } from './page-link-sync';

describe('syncOutboundLinks (integration)', () => {
  const fromPage = new Types.ObjectId();

  beforeEach(async () => {
    await PageLink.deleteMany({ fromPage });
  });

  // Fetch this page's outbound rows in a stable, comparable shape.
  const outboundRows = () =>
    PageLink.find({ fromPage })
      .select('toPath toPage -_id')
      .sort({ toPath: 1 })
      .lean();

  // Capture the persisted _id per toPath so churn (delete + re-insert) can be
  // detected: an in-place update keeps the same _id, a re-insert changes it.
  const outboundIds = async () => {
    const rows = await PageLink.find({ fromPage })
      .select('toPath')
      .sort({ toPath: 1 })
      .lean();
    return rows.map((row) => ({ toPath: row.toPath, id: row._id.toString() }));
  };

  it('is idempotent — running twice with the same set yields identical rows', async () => {
    const targetA = new Types.ObjectId();
    const rows: IPageLink[] = [
      { fromPage, toPath: '/a', toPage: targetA },
      // a broken row (unresolved target) must survive both runs, not be re-churned
      { fromPage, toPath: '/missing', toPage: null },
    ];
    // Absolute expectation: the resolved target id is cached in toPage, and the
    // broken row is stored with a null target.
    const expected = [
      { toPath: '/a', toPage: targetA },
      { toPath: '/missing', toPage: null },
    ];

    await syncOutboundLinks(fromPage, rows);
    const afterFirst = await outboundRows();
    const idsAfterFirst = await outboundIds();

    await syncOutboundLinks(fromPage, rows);
    const afterSecond = await outboundRows();
    const idsAfterSecond = await outboundIds();

    // Content is correct after the first run...
    expect(afterFirst).toEqual(expected);
    // ...and the second run changes nothing: no duplicate insert on the
    // { fromPage, toPath } upsert filter.
    expect(afterSecond).toEqual(expected);
    // Every row keeps its original _id across runs, proving the rows are
    // updated in place — no deletion+reinsert churn.
    expect(idsAfterSecond).toEqual(idsAfterFirst);
  });

  it('replaces the previous set — removes dropped links, adds new ones, keeps unchanged', async () => {
    const targetA = new Types.ObjectId();
    const targetB = new Types.ObjectId();
    const targetC = new Types.ObjectId();

    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/a', toPage: targetA },
      { fromPage, toPath: '/b', toPage: targetB },
    ]);

    // /b removed, /c added, /a unchanged
    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/a', toPage: targetA },
      { fromPage, toPath: '/c', toPage: targetC },
    ]);

    const rows = await outboundRows();
    // Assert full rows: /a keeps its original target, /c is added, /b is gone.
    expect(rows).toEqual([
      { toPath: '/a', toPage: targetA },
      { toPath: '/c', toPage: targetC },
    ]);
  });

  it('excludes a self-permalink row end-to-end', async () => {
    const other = new Types.ObjectId();

    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/other', toPage: other },
      // link to the source page's own permalink — must never become its own backlink
      { fromPage, toPath: `/${fromPage.toString()}`, toPage: fromPage },
    ]);

    const rows = await outboundRows();
    // Only the non-self link survives, with its target cached.
    expect(rows).toEqual([{ toPath: '/other', toPage: other }]);
  });

  it('clears all outbound rows when the page has no links left', async () => {
    const targetA = new Types.ObjectId();
    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/a', toPage: targetA },
    ]);
    expect(await outboundRows()).toHaveLength(1);

    await syncOutboundLinks(fromPage, []);

    expect(await outboundRows()).toEqual([]);
  });
});

describe('reResolveByToPath (integration)', () => {
  let Page: PageModel;
  let createdPages: Types.ObjectId[] = [];
  let createdLinks: Types.ObjectId[] = [];
  let createdRedirects: Types.ObjectId[] = [];

  beforeAll(async () => {
    await PageModelFactory(null);
    Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');
  });

  afterEach(async () => {
    await Page.deleteMany({ _id: { $in: createdPages } });
    await PageLink.deleteMany({ _id: { $in: createdLinks } });
    await PageRedirect.deleteMany({ _id: { $in: createdRedirects } });
    createdPages = [];
    createdLinks = [];
    createdRedirects = [];
  });

  const createPage = async (
    path: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.create({ path });
    createdPages.push(page._id);
    return page;
  };

  const createLink = async (row: IPageLink): Promise<void> => {
    const link = await PageLink.create(row);
    createdLinks.push(link._id);
  };

  /** Stands in for what a rename with "create redirect page" leaves behind. */
  const createRedirect = async (
    fromPath: string,
    toPath: string,
  ): Promise<void> => {
    const redirect = await PageRedirect.create({ fromPath, toPath });
    createdRedirects.push(redirect._id);
  };

  // Whole row set, so a dropped or extra row fails too — not just a wrong target.
  const inboundRows = (toPath: string) =>
    PageLink.find({ toPath })
      .select('fromPage toPage -_id')
      .sort({ fromPage: 1 })
      .lean();

  it('repoints a stale cache at the page that now occupies the path', async () => {
    const source = new Types.ObjectId();
    const previousOccupant = new Types.ObjectId();
    await createLink({
      fromPage: source,
      toPath: '/re-resolve-integ/reused',
      toPage: previousOccupant,
    });
    const occupant = await createPage('/re-resolve-integ/reused');

    await reResolveByToPath('/re-resolve-integ/reused');

    expect(await inboundRows('/re-resolve-integ/reused')).toEqual([
      { fromPage: source, toPage: occupant._id },
    ]);
  });

  it('heals a broken row when a page appears at the path', async () => {
    const source = new Types.ObjectId();
    await createLink({
      fromPage: source,
      toPath: '/re-resolve-integ/created-later',
      toPage: null,
    });
    const page = await createPage('/re-resolve-integ/created-later');

    await reResolveByToPath('/re-resolve-integ/created-later');

    expect(await inboundRows('/re-resolve-integ/created-later')).toEqual([
      { fromPage: source, toPage: page._id },
    ]);
  });

  it('nulls the cache when nothing resolves at the path (row becomes broken)', async () => {
    const source = new Types.ObjectId();
    await createLink({
      fromPage: source,
      toPath: '/re-resolve-integ/vanished',
      toPage: new Types.ObjectId(),
    });

    await reResolveByToPath('/re-resolve-integ/vanished');

    expect(await inboundRows('/re-resolve-integ/vanished')).toEqual([
      { fromPage: source, toPage: null },
    ]);
  });

  it('repoints every source linking to the path, and leaves other paths untouched', async () => {
    const sourceA = new Types.ObjectId();
    const sourceB = new Types.ObjectId();
    const untouchedTarget = new Types.ObjectId();
    await createLink({
      fromPage: sourceA,
      toPath: '/re-resolve-integ/shared',
      toPage: null,
    });
    await createLink({
      fromPage: sourceB,
      toPath: '/re-resolve-integ/shared',
      toPage: null,
    });
    await createLink({
      fromPage: sourceA,
      toPath: '/re-resolve-integ/unrelated',
      toPage: untouchedTarget,
    });
    const page = await createPage('/re-resolve-integ/shared');

    await reResolveByToPath('/re-resolve-integ/shared');

    const rows = await inboundRows('/re-resolve-integ/shared');
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { fromPage: sourceA, toPage: page._id },
        { fromPage: sourceB, toPage: page._id },
      ]),
    );
    expect(await inboundRows('/re-resolve-integ/unrelated')).toEqual([
      { fromPage: sourceA, toPage: untouchedTarget },
    ]);
  });

  it('resolves through a redirect, so a link to a renamed-away path is repointed at the target', async () => {
    const source = new Types.ObjectId();
    await createLink({
      fromPage: source,
      toPath: '/re-resolve-integ/old-name',
      toPage: null,
    });
    const page = await createPage('/re-resolve-integ/new-name');
    await createRedirect(
      '/re-resolve-integ/old-name',
      '/re-resolve-integ/new-name',
    );

    await reResolveByToPath('/re-resolve-integ/old-name');

    expect(await inboundRows('/re-resolve-integ/old-name')).toEqual([
      { fromPage: source, toPage: page._id },
    ]);
  });

  it('repoints rows that reach the path through a redirect, not only exact matches', async () => {
    // /redir-a was renamed to /redir-mid, then /redir-mid to /redir-final. Creating
    // a page at /redir-mid deletes that path's own redirect, so /redir-a's chain now
    // ends at /redir-mid: a click on /redir-a lands on the new page, so the row must
    // point there too. Its cached target is the page the chain used to end at.
    const original = await createPage('/re-resolve-integ/redir-final');
    await createRedirect(
      '/re-resolve-integ/redir-a',
      '/re-resolve-integ/redir-mid',
    );
    const newOccupant = await createPage('/re-resolve-integ/redir-mid');
    const source = new Types.ObjectId();
    await createLink({
      fromPage: source,
      toPath: '/re-resolve-integ/redir-a',
      toPage: original._id,
    });

    await reResolveByToPath('/re-resolve-integ/redir-mid');

    expect(await inboundRows('/re-resolve-integ/redir-a')).toEqual([
      { fromPage: source, toPage: newOccupant._id },
    ]);
  });

  it('clears the row whose source is the target, still repointing the others', async () => {
    // The page was renamed away from this path but its body still links to the old
    // one, so the path resolves back to the linking page itself. Its row is seeded
    // non-null: that stale target is what must not survive.
    const source = await createPage('/re-resolve-integ/self-new');
    await createRedirect(
      '/re-resolve-integ/self-old',
      '/re-resolve-integ/self-new',
    );
    const previousOccupant = new Types.ObjectId();
    const otherSource = new Types.ObjectId();
    const unrelatedTarget = new Types.ObjectId();
    await createLink({
      fromPage: source._id,
      toPath: '/re-resolve-integ/self-old',
      toPage: previousOccupant,
    });
    await createLink({
      fromPage: otherSource,
      toPath: '/re-resolve-integ/self-old',
      toPage: null,
    });
    // The same source links elsewhere: clearing its self row must stay scoped to
    // this path.
    await createLink({
      fromPage: source._id,
      toPath: '/re-resolve-integ/self-elsewhere',
      toPage: unrelatedTarget,
    });

    await reResolveByToPath('/re-resolve-integ/self-old');

    const rows = await inboundRows('/re-resolve-integ/self-old');
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        // no self-backlink, and no stale target left behind
        { fromPage: source._id, toPage: null },
        // ...without holding back the rest of the path
        { fromPage: otherSource, toPage: source._id },
      ]),
    );
    expect(await inboundRows('/re-resolve-integ/self-elsewhere')).toEqual([
      { fromPage: source._id, toPage: unrelatedTarget },
    ]);
  });
});

describe('PageLink.repointInboundLinks (integration)', () => {
  let createdLinks: Types.ObjectId[] = [];

  afterEach(async () => {
    await PageLink.deleteMany({ _id: { $in: createdLinks } });
    createdLinks = [];
  });

  const createLink = async (row: IPageLink): Promise<void> => {
    const link = await PageLink.create(row);
    createdLinks.push(link._id);
  };

  const inboundRows = (toPath: string) =>
    PageLink.find({ toPath })
      .select('fromPage toPage -_id')
      .sort({ fromPage: 1 })
      .lean();

  // A row at an unrelated path: its survival is what proves nothing was written.
  const seedBystander = async (): Promise<{
    source: Types.ObjectId;
    target: Types.ObjectId;
  }> => {
    const source = new Types.ObjectId();
    const target = new Types.ObjectId();
    await createLink({
      fromPage: source,
      toPath: '/repoint-guard/bystander',
      toPage: target,
    });
    return { source, target };
  };

  // The casts are the point: the guard exists because callers can violate the type.
  it.each([
    // Silent without the guard — mongoose matches nothing, hiding the caller's bug.
    ['undefined', undefined as unknown as string],
    // Destructive without the guard — matches every row.
    ['a query operator object', { $ne: null } as unknown as string],
    // Silent without the guard — no row carries an empty path.
    ['an empty string', ''],
  ])('rejects %s as toPath, leaving every row untouched', async (_label, badToPath) => {
    const { source, target } = await seedBystander();

    // Matched on the message: for the two inputs mongoose would ignore anyway,
    // this is the only assertion that tells the guard from an unrelated failure.
    await expect(PageLink.repointInboundLinks(badToPath, null)).rejects.toThrow(
      /non-empty path string/,
    );

    expect(await inboundRows('/repoint-guard/bystander')).toEqual([
      { fromPage: source, toPage: target },
    ]);
  });

  it('rejects a toPage that is not an id, leaving every row untouched', async () => {
    const { source, target } = await seedBystander();

    // Unguarded this is written, not rejected: the update is a pipeline, which
    // mongoose does not cast, so the expression is evaluated into the column.
    await expect(
      PageLink.repointInboundLinks('/repoint-guard/bystander', {
        $literal: 'pwned',
      } as unknown as Types.ObjectId),
    ).rejects.toThrow(/ObjectId or null/);

    expect(await inboundRows('/repoint-guard/bystander')).toEqual([
      { fromPage: source, toPage: target },
    ]);
  });
});
