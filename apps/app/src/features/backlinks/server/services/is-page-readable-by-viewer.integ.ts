import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';

import { isPageReadableByViewer } from './is-page-readable-by-viewer';

/*
 * Guards the backlinks endpoint: it answers only for a page the viewer can open.
 * Contract (design.md § Security; rules/page-write-action-403-404.md).
 */
describe('isPageReadableByViewer (integration)', () => {
  const PREFIX = '/backlinks-page-readable-test';
  const USERNAMES = ['iprv-owner', 'iprv-other'];

  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI; typing it precisely fights mongoose generics for no gain in a test.
  let User: any;

  let rootPage: PageDocument;
  let owner: IUserHasId;
  let other: IUserHasId;

  const createPage = (path: string, fields: Partial<PageDocument>) =>
    Page.create({
      path: `${PREFIX}${path}`,
      grant: Page.GRANT_PUBLIC,
      isEmpty: false,
      parent: rootPage._id,
      ...fields,
    });

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    const existingRoot = await Page.findOne({ path: '/' });
    rootPage =
      existingRoot ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));

    // Leftovers from an aborted run would trip the unique username/email index.
    await User.deleteMany({ username: { $in: USERNAMES } });
    await User.insertMany(
      USERNAMES.map((name) => ({
        name,
        username: name,
        email: `${name}@example.com`,
      })),
    );
    owner = await User.findOne({ username: 'iprv-owner' });
    other = await User.findOne({ username: 'iprv-other' });
  });

  afterEach(async () => {
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
  });

  afterAll(async () => {
    await User.deleteMany({ username: { $in: USERNAMES } });
  });

  it('is true for a public page, for a user and for a guest', async () => {
    const page = await createPage('/public', {});

    expect(await isPageReadableByViewer(page._id, other)).toBe(true);
    expect(await isPageReadableByViewer(page._id, null)).toBe(true);
  });

  it('is false for an owner-restricted page to anyone but its owner', async () => {
    const page = await createPage('/owner-only', {
      grant: Page.GRANT_OWNER,
      grantedUsers: [new mongoose.Types.ObjectId(owner._id)],
    });

    expect(await isPageReadableByViewer(page._id, other)).toBe(false);
    expect(await isPageReadableByViewer(page._id, null)).toBe(false);
    // Positive control: the grant is what hides it, not a missing page.
    expect(await isPageReadableByViewer(page._id, owner)).toBe(true);
  });

  it('is true for an "anyone with the link" page, as opening it by id is', async () => {
    const page = await createPage('/link-shared', {
      grant: Page.GRANT_RESTRICTED,
    });

    expect(await isPageReadableByViewer(page._id, other)).toBe(true);
  });

  it('is true for an empty page', async () => {
    const page = await createPage('/empty', { isEmpty: true });

    expect(await isPageReadableByViewer(page._id, other)).toBe(true);
  });

  it('is false for a page that does not exist', async () => {
    const missing = new mongoose.Types.ObjectId();

    expect(await isPageReadableByViewer(missing, owner)).toBe(false);
  });
});
