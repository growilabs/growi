import { Types } from 'mongoose';

import type { PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import PageLink from '../models/page-link';
import { handlePageUpsertById } from './page-link-service-handlers';

// resolveToPageIds has its own coverage (target-page-resolution.spec.ts); mock it so this test
// isolates the handler's contract against the real PageLink collection.
const mocks = vi.hoisted(() => ({ resolveToPageIds: vi.fn() }));
vi.mock('./target-page-resolution', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveToPageIds: mocks.resolveToPageIds,
}));

/*
 * B2.2 — the coalescing queue holds ids, so the drain entry point loads the page itself: the body
 * is read from the database at drain time, not taken from the event payload.
 */
describe('handlePageUpsertById (integration)', () => {
  const PREFIX = '/backlinks-upsert-by-id-test';
  const siteUrl = 'https://wiki.example';
  const idByPath = new Map<string, Types.ObjectId>();
  const createdPageIds: Types.ObjectId[] = [];

  let Page: PageModel;

  beforeAll(() => {
    // The Page model is registered by its factory rather than on import; the schema does not
    // need a crowi instance here.
    Page = PageModelFactory(null);
  });

  afterEach(async () => {
    await PageLink.deleteMany({ fromPage: { $in: createdPageIds } });
    await Page.deleteMany({ _id: { $in: createdPageIds } });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: createdPageIds.map((id) => id.toString()) } },
    });
    createdPageIds.length = 0;
  });

  beforeEach(() => {
    idByPath.clear();
    // Mirror the real batch contract: return a Map of only the paths that resolve;
    // unresolved paths are absent (the handler reads them back as null).
    mocks.resolveToPageIds.mockImplementation((paths: string[]) => {
      const result = new Map<string, Types.ObjectId>();
      for (const path of paths) {
        const id = idByPath.get(path);
        if (id != null) result.set(path, id);
      }
      return Promise.resolve(result);
    });
  });

  // The id is minted here rather than read back off the document so it is known to be defined.
  const createPage = async (
    path: string,
    body: string,
  ): Promise<Types.ObjectId> => {
    const pageId = new Types.ObjectId();
    await Page.create({ _id: pageId, path: `${PREFIX}${path}`, grant: 1 });
    createdPageIds.push(pageId);
    await setRevision(pageId, body);
    return pageId;
  };

  const setRevision = async (
    pageId: Types.ObjectId,
    body: string,
  ): Promise<void> => {
    const revision = await prisma.revisions.create({
      data: { pageId: pageId.toString(), body },
    });
    await Page.updateOne(
      { _id: pageId },
      { $set: { revision: new Types.ObjectId(revision.id) } },
    );
  };

  const outboundRowsOf = (pageId: Types.ObjectId) =>
    PageLink.find({ fromPage: pageId })
      .select('toPath toPage -_id')
      .sort({ toPath: 1 })
      .lean();

  it('records internal links from path links and same-wiki absolute URLs', async () => {
    const docsId = new Types.ObjectId();
    const dealsId = new Types.ObjectId();
    idByPath.set('/docs/target', docsId);
    idByPath.set('/company/deals', dealsId);

    const pageId = await createPage(
      '/from',
      `[docs](/docs/target) <a href="${siteUrl}/company/deals">deal</a>`,
    );

    await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([
      { toPath: '/company/deals', toPage: dealsId },
      { toPath: '/docs/target', toPage: docsId },
    ]);
  });

  it('excludes an absolute URL that points to a different host', async () => {
    const dealsId = new Types.ObjectId();
    idByPath.set('/company/deals', dealsId);

    const pageId = await createPage(
      '/from',
      `<a href="${siteUrl}/company/deals">deal</a> <a href="https://other.example/elsewhere">ext</a>`,
    );

    await handlePageUpsertById(pageId.toString(), siteUrl);

    // The different-host URL is dropped: the full-set assertion fails if it is
    // recorded at all, with either an id or a null target.
    expect(await outboundRowsOf(pageId)).toEqual([
      { toPath: '/company/deals', toPage: dealsId },
    ]);
  });

  it('excludes a link to the page itself', async () => {
    const otherId = new Types.ObjectId();
    idByPath.set('/other', otherId);

    const pageId = await createPage(
      '/from',
      `[self](${PREFIX}/from) [other](/other)`,
    );

    await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([
      { toPath: '/other', toPage: otherId },
    ]);
  });

  it('picks up the latest body when the page was saved again after being queued', async () => {
    idByPath.set('/a', new Types.ObjectId());
    const bId = new Types.ObjectId();
    idByPath.set('/b', bId);
    const pageId = await createPage('/from', '[a](/a)');

    // A later save replaces the revision while the id sits in the queue; the drain must see it.
    await setRevision(pageId, '[b](/b)');

    await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([
      { toPath: '/b', toPage: bId },
    ]);
  });

  it('replaces outbound rows when the body changes on a later save', async () => {
    const aId = new Types.ObjectId();
    const cId = new Types.ObjectId();
    idByPath.set('/a', aId);
    idByPath.set('/c', cId);
    // '/b' stays unmapped -> resolves to null (a broken row) and must still be removed.

    const pageId = await createPage('/from', '[a](/a) [b](/b)');
    await handlePageUpsertById(pageId.toString(), siteUrl);

    await setRevision(pageId, '[a](/a) [c](/c)');
    await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([
      { toPath: '/a', toPage: aId },
      { toPath: '/c', toPage: cId },
    ]);
  });

  it('clears the page rows when its links are all removed', async () => {
    idByPath.set('/a', new Types.ObjectId());

    const pageId = await createPage('/from', '[a](/a)');
    await handlePageUpsertById(pageId.toString(), siteUrl);
    expect(await outboundRowsOf(pageId)).toHaveLength(1);

    await setRevision(pageId, 'no links here');
    await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([]);
  });

  it('reports the time it spent extracting, so the queue can pace on it', async () => {
    idByPath.set('/a', new Types.ObjectId());
    // Long enough that the extraction is unambiguously measurable.
    const body = Array.from(
      { length: 200 },
      (_, i) => `## Section ${i}\n\nprose with [a](/a) and \`code\`.\n\n`,
    ).join('');
    const pageId = await createPage('/measured-source', body);

    const extractionMs = await handlePageUpsertById(pageId.toString(), siteUrl);

    // Bracketed rather than just non-zero: the queue rests in proportion to this number, so both a
    // handler that stopped reporting it and one reporting the wrong unit would silently scale
    // pacing by 1000x. A body this size measured ~88ms, so these bounds hold with a wide margin on
    // any machine while still failing on either unit error.
    expect(extractionMs).toBeGreaterThan(2);
    expect(extractionMs).toBeLessThan(1000);
  });

  it('creates no rows for a page that no longer exists', async () => {
    const goneId = new Types.ObjectId();
    idByPath.set('/a', new Types.ObjectId());

    const extractionMs = await handlePageUpsertById(goneId.toString(), siteUrl);

    // A stale queue entry for a deleted source must not leave orphan rows behind.
    expect(await PageLink.find({ fromPage: goneId }).lean()).toEqual([]);
    // Nothing extracted, so no rest is owed.
    expect(extractionMs).toBe(0);
  });

  it('creates no rows for a page trashed while it sat in the queue', async () => {
    idByPath.set('/a', new Types.ObjectId());
    const pageId = await createPage('/trashed-source', '[a](/a)');

    // GROWI's soft delete rewrites the document in place, so unlike the case above the id stays
    // resolvable and the drain still finds the page.
    await Page.updateOne(
      { _id: pageId },
      { $set: { path: `/trash${PREFIX}/trashed-source`, status: 'deleted' } },
    );

    const extractionMs = await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([]);
    expect(extractionMs).toBe(0);
  });

  it('still indexes a legacy page whose status is unset', async () => {
    const targetId = new Types.ObjectId();
    idByPath.set('/a', targetId);
    const pageId = await createPage('/legacy-source', '[a](/a)');

    // A page predating the status field reads back as null, which GROWI treats as published — so
    // the guard has to key on STATUS_DELETED rather than STATUS_PUBLISHED.
    await Page.updateOne({ _id: pageId }, { $unset: { status: '' } });

    await handlePageUpsertById(pageId.toString(), siteUrl);

    expect(await outboundRowsOf(pageId)).toEqual([
      { toPath: '/a', toPage: targetId },
    ]);
  });
});
