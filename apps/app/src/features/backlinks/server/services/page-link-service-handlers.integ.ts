import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { PageDocument } from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import PageLink from '../models/page-link';
import { handlePageUpsert } from './page-link-service-handlers';

// resolveToPages has its own coverage (target-page-resolution.spec.ts); mock it so this test
// isolates the handler's contract against the real PageLink collection.
const mocks = vi.hoisted(() => ({ resolveToPages: vi.fn() }));
vi.mock('./target-page-resolution', () => ({
  resolveToPages: mocks.resolveToPages,
}));

describe('handlePageUpsert (integration)', () => {
  const fromPage = new Types.ObjectId();
  const siteUrl = 'https://wiki.example';
  const idByPath = new Map<string, Types.ObjectId>();

  beforeEach(async () => {
    await PageLink.deleteMany({ fromPage });
    await Revision.deleteMany({ pageId: fromPage });
    idByPath.clear();
    // Mirror the real batch contract: return a Map of only the paths that resolve;
    // unresolved paths are absent (the handler reads them back as null).
    mocks.resolveToPages.mockImplementation((paths: string[]) => {
      const result = new Map<string, Types.ObjectId>();
      for (const path of paths) {
        const id = idByPath.get(path);
        if (id != null) result.set(path, id);
      }
      return Promise.resolve(result);
    });
  });

  const outboundRows = () =>
    PageLink.find({ fromPage })
      .select('toPath toPage -_id')
      .sort({ toPath: 1 })
      .lean();

  // The handler only reads _id, path, and the revision body.
  const pageWithBody = (path: string, body: string): PageDocument =>
    mock<PageDocument>({
      _id: fromPage,
      path,
      revision: { _id: new Types.ObjectId(), body },
    });

  it('records internal links from path links and same-wiki absolute URLs', async () => {
    const docsId = new Types.ObjectId();
    const dealsId = new Types.ObjectId();
    idByPath.set('/docs/target', docsId);
    idByPath.set('/company/deals', dealsId);

    const page = pageWithBody(
      '/from',
      `[docs](/docs/target) <a href="${siteUrl}/company/deals">deal</a>`,
    );

    await handlePageUpsert(page, siteUrl);

    expect(await outboundRows()).toEqual([
      { toPath: '/company/deals', toPage: dealsId },
      { toPath: '/docs/target', toPage: docsId },
    ]);
  });

  it('fetches the body from the revision when the event payload is unpopulated', async () => {
    const aId = new Types.ObjectId();
    idByPath.set('/a', aId);

    // Reference the revision by id only (unpopulated) so the handler must load its body.
    const revision = await Revision.create({
      pageId: fromPage,
      body: '[a](/a)',
    });
    const page = mock<PageDocument>({ _id: fromPage, path: '/from' });
    // Assign the ObjectId directly: mock<T>() would deep-mock it into a proxy and break isPopulated().
    page.revision = revision._id;

    await handlePageUpsert(page, siteUrl);

    expect(await outboundRows()).toEqual([{ toPath: '/a', toPage: aId }]);
  });

  it('excludes an absolute URL that points to a different host', async () => {
    const dealsId = new Types.ObjectId();
    idByPath.set('/company/deals', dealsId);

    const page = pageWithBody(
      '/from',
      `<a href="${siteUrl}/company/deals">deal</a> <a href="https://other.example/elsewhere">ext</a>`,
    );

    await handlePageUpsert(page, siteUrl);

    // The different-host URL is dropped: the full-set assertion fails if it is
    // recorded at all, with either an id or a null target.
    expect(await outboundRows()).toEqual([
      { toPath: '/company/deals', toPage: dealsId },
    ]);
  });

  it('replaces outbound rows when the body changes on a later save', async () => {
    const aId = new Types.ObjectId();
    const cId = new Types.ObjectId();
    idByPath.set('/a', aId);
    idByPath.set('/c', cId);
    // '/b' stays unmapped -> resolves to null (a broken row) and must still be removed.

    await handlePageUpsert(pageWithBody('/from', '[a](/a) [b](/b)'), siteUrl);
    await handlePageUpsert(pageWithBody('/from', '[a](/a) [c](/c)'), siteUrl);

    expect(await outboundRows()).toEqual([
      { toPath: '/a', toPage: aId },
      { toPath: '/c', toPage: cId },
    ]);
  });

  it('excludes a link to the page itself', async () => {
    const otherId = new Types.ObjectId();
    idByPath.set('/other', otherId);

    await handlePageUpsert(
      pageWithBody('/from', '[self](/from) [other](/other)'),
      siteUrl,
    );

    expect(await outboundRows()).toEqual([
      { toPath: '/other', toPage: otherId },
    ]);
  });

  it('clears the page rows when its links are all removed', async () => {
    idByPath.set('/a', new Types.ObjectId());

    await handlePageUpsert(pageWithBody('/from', '[a](/a)'), siteUrl);
    expect(await outboundRows()).toHaveLength(1);

    await handlePageUpsert(pageWithBody('/from', 'no links here'), siteUrl);

    expect(await outboundRows()).toEqual([]);
  });
});
