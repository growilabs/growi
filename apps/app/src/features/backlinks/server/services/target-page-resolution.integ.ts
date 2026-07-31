import type { HydratedDocument } from 'mongoose';
import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import PageRedirect from '~/server/models/page-redirect';

import { resolveToPages } from './target-page-resolution';

describe('resolveToPages (integration)', () => {
  let Page: PageModel;
  let created: Types.ObjectId[] = [];
  let createdRedirects: Types.ObjectId[] = [];

  beforeAll(async () => {
    await PageModelFactory(null);
    Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');
  });

  afterEach(async () => {
    await Page.deleteMany({ _id: { $in: created } });
    await PageRedirect.deleteMany({ _id: { $in: createdRedirects } });
    created = [];
    createdRedirects = [];
  });

  const createPage = async (
    attrs: Partial<PageDocument> & { path: string },
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.create(attrs);
    created.push(page._id);
    return page;
  };

  /** Stands in for what a rename with "create redirect page" leaves behind. */
  const createRedirect = async (
    fromPath: string,
    toPath: string,
  ): Promise<void> => {
    const redirect = await PageRedirect.create({ fromPath, toPath });
    createdRedirects.push(redirect._id);
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

  describe('rename following', () => {
    it('resolves a renamed target through its redirect, keyed by the original path', async () => {
      const page = await createPage({ path: '/resolve-integ/new' });
      await createRedirect('/resolve-integ/old', '/resolve-integ/new');

      const result = await resolveToPages(['/resolve-integ/old']);

      // The link keeps working; the key stays what the page body says.
      expect(result.get('/resolve-integ/old')?.toString()).toBe(
        page._id.toString(),
      );
      expect(result.size).toBe(1);
    });

    it('follows a multi-hop rename chain to its endpoint', async () => {
      const page = await createPage({ path: '/resolve-integ/c' });
      await createRedirect('/resolve-integ/a', '/resolve-integ/b');
      await createRedirect('/resolve-integ/b', '/resolve-integ/c');

      const result = await resolveToPages(['/resolve-integ/a']);

      expect(result.get('/resolve-integ/a')?.toString()).toBe(
        page._id.toString(),
      );
    });

    it('prefers a live page at the path over its redirect', async () => {
      // The old path was renamed away, then a new page was created at it: a click
      // lands on the new occupant, so resolution must too.
      const occupant = await createPage({ path: '/resolve-integ/reused' });
      const renamed = await createPage({ path: '/resolve-integ/moved-to' });
      await createRedirect('/resolve-integ/reused', '/resolve-integ/moved-to');

      const result = await resolveToPages(['/resolve-integ/reused']);

      expect(result.get('/resolve-integ/reused')?.toString()).toBe(
        occupant._id.toString(),
      );
      expect(result.get('/resolve-integ/reused')?.toString()).not.toBe(
        renamed._id.toString(),
      );
    });

    it('omits a path whose redirect endpoint has no page', async () => {
      // Renamed, then permanently deleted — genuinely broken.
      await createRedirect('/resolve-integ/gone', '/resolve-integ/also-gone');

      const result = await resolveToPages(['/resolve-integ/gone']);

      expect(result.size).toBe(0);
    });

    it('does not repoint a permalink whose page is gone, even when a redirect exists on that path', async () => {
      const deletedId = new mongoose.Types.ObjectId();
      await createRedirect(
        `/${deletedId.toString()}`,
        '/resolve-integ/decoy-target',
      );
      await createPage({ path: '/resolve-integ/decoy-target' });

      const result = await resolveToPages([`/${deletedId.toString()}`]);

      // A permalink names the immutable _id, so it must resolve to that page or to
      // nothing — never to whatever a redirect on the same path points at.
      expect(result.size).toBe(0);
    });

    it('does not hang or resolve on a redirect cycle', async () => {
      // Real $graphLookup, so this exercises its own cycle protection: it visits
      // each document once, leaving an endpoint that has no page.
      await createRedirect('/resolve-integ/cycle-a', '/resolve-integ/cycle-b');
      await createRedirect('/resolve-integ/cycle-b', '/resolve-integ/cycle-a');

      const result = await resolveToPages(['/resolve-integ/cycle-a']);

      expect(result.size).toBe(0);
    });
  });
});
