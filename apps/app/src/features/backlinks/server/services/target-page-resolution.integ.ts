import type { HydratedDocument } from 'mongoose';
import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import PageRedirect from '~/server/models/page-redirect';

import { resolveToPageIds } from './target-page-resolution';

describe('resolveToPageIds (integration)', () => {
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

    const result = await resolveToPageIds(['/resolve-integ/docs']);

    expect(result.get('/resolve-integ/docs')?.toString()).toBe(
      page._id.toString(),
    );
    expect(result.size).toBe(1);
  });

  it('resolves a permalink to its page id, keyed by the original input', async () => {
    const page = await createPage({ path: '/resolve-integ/by-permalink' });
    const permalink = `/${page._id.toString()}`;

    const result = await resolveToPageIds([permalink]);

    expect(result.get(permalink)?.toString()).toBe(page._id.toString());
    expect(result.size).toBe(1);
  });

  it('excludes an empty page from path resolution', async () => {
    // Empty pages (v5 folder placeholders) are not real link targets and must not resolve.
    await createPage({ path: '/resolve-integ/empty', isEmpty: true });

    const result = await resolveToPageIds(['/resolve-integ/empty']);

    expect(result.size).toBe(0);
  });

  it('omits an input with no matching page', async () => {
    const result = await resolveToPageIds(['/resolve-integ/missing']);

    expect(result.size).toBe(0);
  });

  it('resolves permalinks and regular paths together', async () => {
    const permalinkPage = await createPage({ path: '/resolve-integ/pl' });
    const pathPage = await createPage({ path: '/resolve-integ/np' });
    const permalink = `/${permalinkPage._id.toString()}`;

    const result = await resolveToPageIds([permalink, '/resolve-integ/np']);

    expect(result.get(permalink)?.toString()).toBe(
      permalinkPage._id.toString(),
    );
    expect(result.get('/resolve-integ/np')?.toString()).toBe(
      pathPage._id.toString(),
    );
    expect(result.size).toBe(2);
  });

  // Rename and soft delete both leave a PageRedirect behind, so both are followed here.
  describe('redirect following', () => {
    it('resolves a renamed target through its redirect, keyed by the original path', async () => {
      const page = await createPage({ path: '/resolve-integ/new' });
      await createRedirect('/resolve-integ/old', '/resolve-integ/new');

      const result = await resolveToPageIds(['/resolve-integ/old']);

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

      const result = await resolveToPageIds(['/resolve-integ/a']);

      expect(result.get('/resolve-integ/a')?.toString()).toBe(
        page._id.toString(),
      );
    });

    it('resolves several renamed targets in one pass', async () => {
      // Only a real pipeline shows $in returning a chain per input.
      const pageX = await createPage({ path: '/resolve-integ/x2' });
      const pageY = await createPage({ path: '/resolve-integ/y2' });
      await createRedirect('/resolve-integ/x', '/resolve-integ/x2');
      await createRedirect('/resolve-integ/y', '/resolve-integ/y2');

      const result = await resolveToPageIds([
        '/resolve-integ/x',
        '/resolve-integ/y',
      ]);

      expect(result.get('/resolve-integ/x')?.toString()).toBe(
        pageX._id.toString(),
      );
      expect(result.get('/resolve-integ/y')?.toString()).toBe(
        pageY._id.toString(),
      );
      expect(result.size).toBe(2);
    });

    it('follows the redirect even when a live page occupies the path', async () => {
      // The old path was renamed away and later reoccupied while its redirect
      // survived (page creation deletes it, but from a sub-operation that is not
      // awaited and swallows its own failure). Page view resolves such a path
      // through the redirect without ever looking for a live page at it, so a
      // click lands on the rename target — and resolution has to agree, or the
      // backlink would be listed under a page no click ever reaches.
      const occupant = await createPage({ path: '/resolve-integ/reused' });
      const renamed = await createPage({ path: '/resolve-integ/moved-to' });
      await createRedirect('/resolve-integ/reused', '/resolve-integ/moved-to');

      const result = await resolveToPageIds(['/resolve-integ/reused']);

      expect(result.get('/resolve-integ/reused')?.toString()).toBe(
        renamed._id.toString(),
      );
      expect(result.get('/resolve-integ/reused')?.toString()).not.toBe(
        occupant._id.toString(),
      );
    });

    it('omits a path whose redirect endpoint has no page', async () => {
      // Renamed, then permanently deleted — genuinely broken.
      await createRedirect('/resolve-integ/gone', '/resolve-integ/also-gone');

      const result = await resolveToPageIds(['/resolve-integ/gone']);

      expect(result.size).toBe(0);
    });

    it('does not repoint a permalink whose page is gone, even when a redirect exists on that path', async () => {
      const deletedId = new mongoose.Types.ObjectId();
      await createRedirect(
        `/${deletedId.toString()}`,
        '/resolve-integ/decoy-target',
      );
      await createPage({ path: '/resolve-integ/decoy-target' });

      const result = await resolveToPageIds([`/${deletedId.toString()}`]);

      // A permalink names the immutable _id, so it must resolve to that page or to
      // nothing — never to whatever a redirect on the same path points at.
      expect(result.size).toBe(0);
    });

    it('resolves a soft-deleted target through its trash redirect', async () => {
      // Soft delete moves the page under /trash and leaves a PageRedirect behind
      // (deleteNonEmptyTarget), so B5 can derive `trashed` rather than `broken`.
      const page = await createPage({
        path: '/trash/resolve-integ/binned',
        status: Page.STATUS_DELETED,
      });
      await createRedirect(
        '/resolve-integ/binned',
        '/trash/resolve-integ/binned',
      );

      const result = await resolveToPageIds(['/resolve-integ/binned']);

      expect(result.get('/resolve-integ/binned')?.toString()).toBe(
        page._id.toString(),
      );
      expect(result.size).toBe(1);
    });

    it('advances exactly one hop on a redirect cycle, as page view does', async () => {
      // Real $graphLookup. A cycle does not leave the chain unresolved: the walk
      // comes back to the starting document, which then *is* the deepest hop, so
      // the endpoint collapses to the start's own next hop. A page there resolves.
      // The same static backs page view, so both land on the same page.
      const page = await createPage({ path: '/resolve-integ/cycle-b' });
      await createRedirect('/resolve-integ/cycle-a', '/resolve-integ/cycle-b');
      await createRedirect('/resolve-integ/cycle-b', '/resolve-integ/cycle-a');

      const result = await resolveToPageIds(['/resolve-integ/cycle-a']);

      expect(result.get('/resolve-integ/cycle-a')?.toString()).toBe(
        page._id.toString(),
      );
    });

    it('does not hang on a redirect cycle whose one-hop endpoint has no page', async () => {
      await createRedirect('/resolve-integ/cycle-a', '/resolve-integ/cycle-b');
      await createRedirect('/resolve-integ/cycle-b', '/resolve-integ/cycle-a');

      const result = await resolveToPageIds(['/resolve-integ/cycle-a']);

      expect(result.size).toBe(0);
    });
  });
});
