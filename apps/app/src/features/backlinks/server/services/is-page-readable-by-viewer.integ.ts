import { GroupType, type IUserHasId } from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';

import { findUserGroupIdsForViewer } from './find-user-group-ids-for-viewer';
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

  // As the route does: resolve the viewer's groups once, then check.
  const canRead = async (
    pageId: mongoose.Types.ObjectId,
    user: IUserHasId | null,
  ) =>
    isPageReadableByViewer(pageId, user, await findUserGroupIdsForViewer(user));

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

    expect(await canRead(page._id, other)).toBe(true);
    expect(await canRead(page._id, null)).toBe(true);
  });

  it('is false for an owner-restricted page to anyone but its owner', async () => {
    const page = await createPage('/owner-only', {
      grant: Page.GRANT_OWNER,
      grantedUsers: [new mongoose.Types.ObjectId(owner._id)],
    });

    expect(await canRead(page._id, other)).toBe(false);
    expect(await canRead(page._id, null)).toBe(false);
    // Positive control: the grant is what hides it, not a missing page.
    expect(await canRead(page._id, owner)).toBe(true);
  });

  it('is true for an "anyone with the link" page, as opening it by id is', async () => {
    const page = await createPage('/link-shared', {
      grant: Page.GRANT_RESTRICTED,
    });

    expect(await canRead(page._id, other)).toBe(true);
  });

  it('is true for an empty page', async () => {
    const page = await createPage('/empty', { isEmpty: true });

    expect(await canRead(page._id, other)).toBe(true);
  });

  it('is false for a page that does not exist', async () => {
    const missing = new mongoose.Types.ObjectId();

    expect(await canRead(missing, owner)).toBe(false);
  });

  it('decides a group-granted page by the group ids it is handed', async () => {
    const groupId = new mongoose.Types.ObjectId();
    const page = await createPage('/group-only', {
      grant: Page.GRANT_USER_GROUP,
      grantedGroups: [{ type: GroupType.userGroup, item: groupId }],
    });

    // `other` belongs to no group in the database, so a readable answer can only come
    // from the ids the caller passed — not from a lookup of its own.
    expect(await isPageReadableByViewer(page._id, other, [groupId])).toBe(true);
    expect(await isPageReadableByViewer(page._id, other, [])).toBe(false);
  });

  describe('with security:disableUserPages', () => {
    let disableUserPagesInDbBefore: boolean | undefined;

    beforeAll(() => {
      disableUserPagesInDbBefore = configManager.getConfig(
        'security:disableUserPages',
        ConfigSource.db,
      );
    });

    afterEach(async () => {
      await configManager.updateConfigs(
        { 'security:disableUserPages': disableUserPagesInDbBefore },
        { removeIfUndefined: true },
      );
    });

    it('is false for a user page, as a page view is, while the setting is on', async () => {
      const userPage = await Page.create({
        path: `/user/${owner.username}`,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        parent: rootPage._id,
      });

      try {
        await configManager.updateConfig('security:disableUserPages', true);
        expect(await canRead(userPage._id, owner)).toBe(false);

        // Positive control: the setting is what hides it.
        await configManager.updateConfig('security:disableUserPages', false);
        expect(await canRead(userPage._id, owner)).toBe(true);
      } finally {
        await Page.deleteOne({ _id: userPage._id });
      }
    });
  });
});
