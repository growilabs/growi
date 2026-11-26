import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument, Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import { filterUsersWhoCanViewPage } from './filter-page-viewers';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PREFIX = `/filter-page-viewers-integ-${WORKER_ID}`;
const USER_NAMES = ['owner', 'groupMember', 'externalMember', 'outsider'];

type UserName = (typeof USER_NAMES)[number];

describe('filterUsersWhoCanViewPage', () => {
  let Page: PageModel;
  const users: Record<UserName, HydratedDocument<IUserHasId>> = {};
  const pages: Record<string, HydratedDocument<PageDocument>> = {};
  let userGroupId: Types.ObjectId;
  let externalGroupId: Types.ObjectId;

  const allUserIds = () => USER_NAMES.map((name) => users[name]._id);
  const namesOf = (ids: readonly unknown[]) =>
    USER_NAMES.filter((name) =>
      ids.some((id) => String(id) === String(users[name]._id)),
    );

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    const User = mongoose.model<IUserHasId>('User');

    for (const name of USER_NAMES) {
      const username = `fpv-${name}-${WORKER_ID}`;
      // biome-ignore lint/performance/noAwaitInLoops: a few fixture users
      users[name] = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status: 2,
      });
    }

    const userGroup = await UserGroup.create({ name: `fpv-g-${WORKER_ID}` });
    userGroupId = userGroup._id;
    await UserGroupRelation.create({
      relatedGroup: userGroupId,
      relatedUser: users.groupMember._id,
    });
    const externalGroup = await ExternalUserGroup.create({
      name: `fpv-eg-${WORKER_ID}`,
      externalId: `fpv-eg-${WORKER_ID}`,
      provider: 'ldap',
    });
    externalGroupId = externalGroup._id;
    await ExternalUserGroupRelation.create({
      relatedGroup: externalGroupId,
      relatedUser: users.externalMember._id,
    });

    const seeds: Record<string, Partial<PageDocument>> = {
      public: { grant: PageGrant.GRANT_PUBLIC },
      restricted: { grant: PageGrant.GRANT_RESTRICTED },
      owner: {
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [users.owner._id],
      },
      userGroup: {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ item: userGroupId, type: GroupType.userGroup }],
      },
      externalGroup: {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [
          { item: externalGroupId, type: GroupType.externalUserGroup },
        ],
      },
    };
    for (const [key, seed] of Object.entries(seeds)) {
      // biome-ignore lint/performance/noAwaitInLoops: a few fixture pages
      pages[key] = await Page.create({
        path: `${PREFIX}/${key}`,
        creator: users.owner._id,
        lastUpdateUser: users.owner._id,
        ...seed,
      });
    }
  });

  afterAll(async () => {
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
    await UserGroupRelation.deleteMany({ relatedGroup: userGroupId });
    await ExternalUserGroupRelation.deleteMany({
      relatedGroup: externalGroupId,
    });
    await UserGroup.deleteOne({ _id: userGroupId });
    await ExternalUserGroup.deleteOne({ _id: externalGroupId });
    await mongoose
      .model('User')
      .deleteMany({ _id: { $in: Object.values(users).map((u) => u._id) } });
  });

  it.each([
    ['public', USER_NAMES],
    ['restricted', USER_NAMES],
    ['owner', ['owner']],
    ['userGroup', ['groupMember']],
    ['externalGroup', ['externalMember']],
  ])('keeps exactly the users who can open the %s page', async (key, expected) => {
    const page = pages[key];

    // The event carried no grant: the stored page alone decides.
    const kept = await filterUsersWhoCanViewPage(page._id, {}, allUserIds());

    expect(namesOf(kept)).toEqual(expected);
    // Same verdict as the page view itself, so the two cannot drift apart.
    const viewable: UserName[] = [];
    for (const name of USER_NAMES) {
      // biome-ignore lint/performance/noAwaitInLoops: one lookup per fixture user
      if ((await Page.findByIdAndViewer(page._id, users[name])) != null) {
        viewable.push(name);
      }
    }
    expect(namesOf(kept)).toEqual(viewable);
  });

  it('judges by the stored grant even when the event carried an older one', async () => {
    const kept = await filterUsersWhoCanViewPage(
      pages.owner._id,
      { grant: PageGrant.GRANT_PUBLIC },
      allUserIds(),
    );

    expect(namesOf(kept)).toEqual(['owner']);
  });

  it('treats a page stored without a grant as public, like the page view does', async () => {
    const { insertedId } = await Page.collection.insertOne({
      path: `${PREFIX}/legacy-without-grant`,
      creator: users.owner._id,
    });

    const kept = await filterUsersWhoCanViewPage(insertedId, {}, allUserIds());

    expect(namesOf(kept)).toEqual(USER_NAMES);
  });

  it('judges a completely deleted page by the grant the event carried', async () => {
    const kept = await filterUsersWhoCanViewPage(
      new Types.ObjectId(),
      { grant: PageGrant.GRANT_OWNER, grantedUsers: [users.owner._id] },
      allUserIds(),
    );

    expect(namesOf(kept)).toEqual(['owner']);
  });

  it('keeps nobody for a completely deleted page whose event carried no grant', async () => {
    const kept = await filterUsersWhoCanViewPage(
      new Types.ObjectId(),
      { grantedUsers: [users.owner._id] },
      allUserIds(),
    );

    expect(kept).toEqual([]);
  });
});
