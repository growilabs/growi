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
  'security:user-homepage-deletion:isEnabled',
] as const;

describe('PageService deletion authority', () => {
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
    // An empty page has no creator of its own; the closest non-empty ancestor
    // is looked up in the database.
    await Page.create({
      path: '/fpbcd',
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
    await Page.deleteMany({ path: '/fpbcd' });
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

    const filter = (
      pages: PageDocument[],
      user: HydratedDocument<IUser>,
      isCompletely: boolean,
      isRecursively: boolean,
    ) =>
      crowi.pageService.filterPagesByDeletionAuthority(
        pages,
        asOperator(user),
        {
          isCompletely,
          isRecursively,
        },
      );

    it.each([
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ])('filterPagesByDeletionAuthority (isCompletely: %s, isRecursively: %s) drops a page the user neither authored nor administers', async (isCompletely, isRecursively) => {
      const result = await filter(
        [authorsPage],
        otherUser,
        isCompletely,
        isRecursively,
      );

      expect(result).toEqual([]);
    });

    describe('judgeDeletion', () => {
      it.each([
        false,
        true,
      ])('forbids a page the user neither authored nor administers (isCompletely: %s)', async (isCompletely) => {
        const verdict = await crowi.pageService.judgeDeletion(
          authorsPage,
          asOperator(otherUser),
          { isCompletely, isRecursively: false },
        );

        expect(verdict).toBe('forbidden');
      });

      it.each([
        false,
        true,
      ])('permits the author and an admin (isCompletely: %s)', async (isCompletely) => {
        const options = { isCompletely, isRecursively: false };

        expect(
          await crowi.pageService.judgeDeletion(
            authorsPage,
            asOperator(author),
            options,
          ),
        ).toBe('permitted');
        expect(
          await crowi.pageService.judgeDeletion(
            authorsPage,
            asOperator(admin),
            options,
          ),
        ).toBe('permitted');
      });

      it('judges an empty page by its closest non-empty ancestor', async () => {
        const options = { isCompletely: false, isRecursively: false };

        expect(
          await crowi.pageService.judgeDeletion(
            emptyPage,
            asOperator(otherUser),
            options,
          ),
        ).toBe('forbidden');
        expect(
          await crowi.pageService.judgeDeletion(
            emptyPage,
            asOperator(author),
            options,
          ),
        ).toBe('permitted');
      });

      const homepageOf = (username: string) =>
        new Page({
          path: `/user/${username}`,
          grant: Page.GRANT_PUBLIC,
          creator: author._id,
          lastUpdateUser: author._id,
          isEmpty: false,
        });

      describe('when deleting user homepages is enabled', () => {
        beforeAll(async () => {
          await crowi.configManager.updateConfig(
            'security:user-homepage-deletion:isEnabled',
            true,
          );
        });

        // the outer afterAll removes the key
        afterAll(async () => {
          await crowi.configManager.updateConfig(
            'security:user-homepage-deletion:isEnabled',
            false,
          );
        });

        it('still protects the homepage of an existing user', async () => {
          const verdict = await crowi.pageService.judgeDeletion(
            homepageOf(author.username),
            asOperator(admin),
            { isCompletely: false, isRecursively: false },
          );

          expect(verdict).toBe('protected_user_homepage');
        });

        it('permits the homepage of a user who no longer exists', async () => {
          const verdict = await crowi.pageService.judgeDeletion(
            homepageOf('fpbcd-absent-user'),
            asOperator(admin),
            { isCompletely: false, isRecursively: false },
          );

          expect(verdict).toBe('permitted');
        });
      });

      it('protects every user homepage under the default settings, even from an admin', async () => {
        const verdict = await crowi.pageService.judgeDeletion(
          homepageOf('fpbcd-absent-user'),
          asOperator(admin),
          { isCompletely: false, isRecursively: false },
        );

        expect(verdict).toBe('protected_user_homepage');
      });
    });

    it.each([
      false,
      true,
    ])('filterPagesByDeletionAuthority (isCompletely: %s) keeps the page for its author and for an admin', async (isCompletely) => {
      const byAuthor = await filter([authorsPage], author, isCompletely, false);
      const byAdmin = await filter([authorsPage], admin, isCompletely, false);

      expect(byAuthor.map((p) => p.path)).toEqual([authorsPage.path]);
      expect(byAdmin.map((p) => p.path)).toEqual([authorsPage.path]);
    });

    it.each([
      false,
      true,
    ])('filterPagesByDeletionAuthority (isCompletely: %s) keeps an empty page for a non-recursive deletion and drops only the forbidden one', async (isCompletely) => {
      const result = await filter(
        [authorsPage, emptyPage],
        otherUser,
        isCompletely,
        false,
      );

      expect(result.map((p) => p.path)).toEqual([emptyPage.path]);
    });

    it.each([
      false,
      true,
    ])('filterPagesByDeletionAuthority (isCompletely: %s) judges an empty page by its closest non-empty ancestor for a recursive deletion', async (isCompletely) => {
      const byOtherUser = await filter(
        [emptyPage],
        otherUser,
        isCompletely,
        true,
      );
      const byAncestorsAuthor = await filter(
        [emptyPage],
        author,
        isCompletely,
        true,
      );

      expect(byOtherUser).toEqual([]);
      expect(byAncestorsAuthor.map((p) => p.path)).toEqual([emptyPage.path]);
    });
  });
});
