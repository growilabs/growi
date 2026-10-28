import type { IUser, IUserHasId } from '@growi/core';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageDeleteConfigValue } from '~/interfaces/page-delete-config';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

const DELETE_AUTHORITY_KEYS = [
  'security:pageDeletionAuthority',
  'security:pageRecursiveDeletionAuthority',
  'security:pageCompleteDeletionAuthority',
  'security:pageRecursiveCompleteDeletionAuthority',
] as const;

describe('PageService.filterPagesByCanDelete / filterPagesByCanDeleteCompletely', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUser>;

  let author: HydratedDocument<IUser>;
  let otherUser: HydratedDocument<IUser>;
  let admin: HydratedDocument<IUser>;

  let authorsPage: PageDocument;
  let emptyPage: PageDocument;

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model('Page') as PageModel;
    User = mongoose.model('User');

    [author, otherUser, admin] = await User.create([
      {
        name: 'fpbcd author',
        username: 'fpbcd-author',
        email: 'fpbcd-author@example.com',
      },
      {
        name: 'fpbcd other',
        username: 'fpbcd-other',
        email: 'fpbcd-other@example.com',
      },
      {
        name: 'fpbcd admin',
        username: 'fpbcd-admin',
        email: 'fpbcd-admin@example.com',
        admin: true,
      },
    ]);

    authorsPage = new Page({
      path: '/fpbcd/authors-page',
      grant: Page.GRANT_PUBLIC,
      creator: author._id,
      lastUpdateUser: author._id,
      isEmpty: false,
    });
    emptyPage = new Page({
      path: '/fpbcd/empty-page',
      grant: Page.GRANT_PUBLIC,
      isEmpty: true,
    });
  });

  afterAll(async () => {
    await crowi.configManager.updateConfigs(
      Object.fromEntries(DELETE_AUTHORITY_KEYS.map((key) => [key, undefined])),
      { removeIfUndefined: true },
    );
    await User.deleteMany({ username: { $regex: /^fpbcd-/ } });
  });

  const asOperator = (user: HydratedDocument<IUser>): IUserHasId =>
    user.toObject() as IUserHasId;

  describe('when deletion is restricted to admins and authors', () => {
    beforeAll(async () => {
      await crowi.configManager.updateConfigs({
        'security:pageDeletionAuthority': PageDeleteConfigValue.AdminAndAuthor,
        'security:pageRecursiveDeletionAuthority':
          PageDeleteConfigValue.Inherit,
        'security:pageCompleteDeletionAuthority':
          PageDeleteConfigValue.AdminAndAuthor,
        'security:pageRecursiveCompleteDeletionAuthority':
          PageDeleteConfigValue.Inherit,
      });
    });

    it.each([
      ['filterPagesByCanDelete', false],
      ['filterPagesByCanDelete', true],
      ['filterPagesByCanDeleteCompletely', false],
      ['filterPagesByCanDeleteCompletely', true],
    ] as const)('%s (isRecursively: %s) drops a page the user neither authored nor administers', async (method, isRecursively) => {
      const result = await crowi.pageService[method](
        [authorsPage],
        asOperator(otherUser),
        isRecursively,
      );

      expect(result).toEqual([]);
    });

    it.each([
      'filterPagesByCanDelete',
      'filterPagesByCanDeleteCompletely',
    ] as const)('%s keeps the page for its author and for an admin', async (method) => {
      const byAuthor = await crowi.pageService[method](
        [authorsPage],
        asOperator(author),
        false,
      );
      const byAdmin = await crowi.pageService[method](
        [authorsPage],
        asOperator(admin),
        false,
      );

      expect(byAuthor.map((p) => p.path)).toEqual([authorsPage.path]);
      expect(byAdmin.map((p) => p.path)).toEqual([authorsPage.path]);
    });

    it.each([
      'filterPagesByCanDelete',
      'filterPagesByCanDeleteCompletely',
    ] as const)('%s keeps an empty page and drops only the forbidden one from a mixed list', async (method) => {
      const result = await crowi.pageService[method](
        [authorsPage, emptyPage],
        asOperator(otherUser),
        true,
      );

      expect(result.map((p) => p.path)).toEqual([emptyPage.path]);
    });
  });
});
