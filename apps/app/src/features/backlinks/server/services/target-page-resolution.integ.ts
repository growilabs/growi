import type { HydratedDocument } from 'mongoose';
import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';

import { resolveToPages } from './target-page-resolution';

describe('resolveToPages (integration)', () => {
  let Page: PageModel;
  let created: Types.ObjectId[] = [];

  beforeAll(async () => {
    await PageModelFactory(null);
    Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');
  });

  afterEach(async () => {
    await Page.deleteMany({ _id: { $in: created } });
    created = [];
  });

  const createPage = async (
    attrs: Partial<PageDocument> & { path: string },
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.create(attrs);
    created.push(page._id);
    return page;
  };

  it('resolves a regular path to its page id', async () => {
    const page = await createPage({ path: '/resolve-integ/docs' });

    const result = await resolveToPages(['/resolve-integ/docs']);

    expect(result.get('/resolve-integ/docs')?.toString()).toBe(
      page._id.toString(),
    );
    expect(result.size).toBe(1);
  });

  it('resolves a permalink to its page id, keyed by the original input', async () => {
    const page = await createPage({ path: '/resolve-integ/by-permalink' });
    const permalink = `/${page._id.toString()}`;

    const result = await resolveToPages([permalink]);

    expect(result.get(permalink)?.toString()).toBe(page._id.toString());
    expect(result.size).toBe(1);
  });

  it('excludes an empty page from path resolution', async () => {
    // Empty pages (v5 folder placeholders) are not real link targets and must not resolve.
    await createPage({ path: '/resolve-integ/empty', isEmpty: true });

    const result = await resolveToPages(['/resolve-integ/empty']);

    expect(result.size).toBe(0);
  });

  it('omits an input with no matching page', async () => {
    const result = await resolveToPages(['/resolve-integ/missing']);

    expect(result.size).toBe(0);
  });

  it('resolves permalinks and regular paths together', async () => {
    const permalinkPage = await createPage({ path: '/resolve-integ/pl' });
    const pathPage = await createPage({ path: '/resolve-integ/np' });
    const permalink = `/${permalinkPage._id.toString()}`;

    const result = await resolveToPages([permalink, '/resolve-integ/np']);

    expect(result.get(permalink)?.toString()).toBe(
      permalinkPage._id.toString(),
    );
    expect(result.get('/resolve-integ/np')?.toString()).toBe(
      pathPage._id.toString(),
    );
    expect(result.size).toBe(2);
  });
});
