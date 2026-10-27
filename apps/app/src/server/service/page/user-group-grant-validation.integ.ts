import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

describe('PageService user group grant validation', () => {
  const PREFIX = '/create-user-group-grant-integ';

  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUserHasId>;
  let memberUser: HydratedDocument<IUserHasId>;
  let memberGroupId: mongoose.Types.ObjectId;
  let foreignGroupId: mongoose.Types.ObjectId;

  const createWithoutSubOperation = async (
    path: string,
    options: Record<string, unknown>,
  ): Promise<HydratedDocument<PageDocument>> => {
    const mockedCreateSubOperation = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());

    try {
      return await crowi.pageService.create(path, 'body', memberUser, options);
    } finally {
      mockedCreateSubOperation.mockRestore();
    }
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');
    const UserGroup = mongoose.model('UserGroup');
    const UserGroupRelation = mongoose.model('UserGroupRelation');

    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();

    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
    // Public parent: the case where the ancestor imposes no group constraint
    await Page.create({ path: PREFIX, grant: Page.GRANT_PUBLIC, parent: null });

    const username = 'createUserGroupGrantUser';
    memberUser =
      (await User.findOne({ username })) ??
      (await User.create({
        name: username,
        username,
        email: 'create-user-group-grant@example.com',
      }));

    const memberGroup = await UserGroup.create({
      name: 'createUserGroupGrantMemberGroup',
    });
    const foreignGroup = await UserGroup.create({
      name: 'createUserGroupGrantForeignGroup',
    });
    memberGroupId = memberGroup._id;
    foreignGroupId = foreignGroup._id;

    await UserGroupRelation.create({
      relatedGroup: memberGroup._id,
      relatedUser: memberUser._id,
    });
  });

  it('creates a page granted to a group the user belongs to', async () => {
    const page = await createWithoutSubOperation(`${PREFIX}/member`, {
      grant: PageGrant.GRANT_USER_GROUP,
      grantUserGroupIds: [{ item: memberGroupId, type: GroupType.userGroup }],
    });

    expect(page.grant).toBe(PageGrant.GRANT_USER_GROUP);
    expect(page.grantedGroups).toHaveLength(1);
  });

  it('rejects GRANT_USER_GROUP with an empty group list and creates no page', async () => {
    const path = `${PREFIX}/empty-groups`;

    await expect(
      createWithoutSubOperation(path, {
        grant: PageGrant.GRANT_USER_GROUP,
        grantUserGroupIds: [],
      }),
    ).rejects.toThrow(/must not be empty/);

    expect(await Page.exists({ path })).toBeNull();
  });

  it('rejects GRANT_USER_GROUP for a group the user does not belong to and creates no page', async () => {
    const path = `${PREFIX}/foreign-group`;

    await expect(
      createWithoutSubOperation(path, {
        grant: PageGrant.GRANT_USER_GROUP,
        grantUserGroupIds: [
          { item: foreignGroupId, type: GroupType.userGroup },
        ],
      }),
    ).rejects.toThrow(/does not belong to any of the granted groups/);

    expect(await Page.exists({ path })).toBeNull();
  });

  it('allows a mixed list when the user belongs to at least one of the groups', async () => {
    const page = await createWithoutSubOperation(`${PREFIX}/mixed-groups`, {
      grant: PageGrant.GRANT_USER_GROUP,
      grantUserGroupIds: [
        { item: memberGroupId, type: GroupType.userGroup },
        { item: foreignGroupId, type: GroupType.userGroup },
      ],
    });

    expect(page.grant).toBe(PageGrant.GRANT_USER_GROUP);
    expect(page.grantedGroups).toHaveLength(2);
  });

  it('rejects inheriting the parent groups when the user belongs to none of them', async () => {
    const parentPath = `${PREFIX}/foreign-parent`;
    const publicParent = await Page.findOne({ path: PREFIX });
    await Page.create({
      path: parentPath,
      grant: Page.GRANT_USER_GROUP,
      grantedGroups: [{ item: foreignGroupId, type: GroupType.userGroup }],
      parent: publicParent?._id,
    });
    const childPath = `${parentPath}/child`;

    await expect(createWithoutSubOperation(childPath, {})).rejects.toThrow(
      /does not belong to any of the granted groups/,
    );

    expect(await Page.exists({ path: childPath })).toBeNull();
  });

  describe('updatePage', () => {
    it('rejects changing a public page to a group the user does not belong to', async () => {
      const path = `${PREFIX}/update-foreign-group`;
      const created = await createWithoutSubOperation(path, {});

      await expect(
        crowi.pageService.updatePage(created, 'new', 'body', memberUser, {
          grant: PageGrant.GRANT_USER_GROUP,
          userRelatedGrantUserGroupIds: [
            { item: foreignGroupId, type: GroupType.userGroup },
          ],
        }),
      ).rejects.toThrow(/does not belong to any of the granted groups/);

      const reloaded = await Page.findById(created._id);
      expect(reloaded?.grant).toBe(PageGrant.GRANT_PUBLIC);
    });

    it('rejects changing a public page to GRANT_USER_GROUP with an empty group list', async () => {
      const path = `${PREFIX}/update-empty-groups`;
      const created = await createWithoutSubOperation(path, {});

      await expect(
        crowi.pageService.updatePage(created, 'new', 'body', memberUser, {
          grant: PageGrant.GRANT_USER_GROUP,
          userRelatedGrantUserGroupIds: [],
        }),
      ).rejects.toThrow();

      const reloaded = await Page.findById(created._id);
      expect(reloaded?.grant).toBe(PageGrant.GRANT_PUBLIC);
    });
  });
});
