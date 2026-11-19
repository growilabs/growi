import type { IPage, IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { prisma } from '~/utils/prisma';

import type { PageModel } from './page';
import UserGroup from './user-group';
import UserGroupRelation from './user-group-relation';

const PATH_PREFIX = '/find-template-integ';
const USERNAME_PREFIX = 'find-template-integ-';

const SECRET_CHILDREN_TEMPLATE_BODY = 'SECRET-CHILDREN-TEMPLATE';
const PUBLIC_ANCESTOR_TEMPLATE_BODY = 'PUBLIC-ANCESTOR-TEMPLATE';
const PUBLIC_CHILDREN_TEMPLATE_BODY = 'PUBLIC-CHILDREN-TEMPLATE';
const ISOLATED_SECRET_TEMPLATE_BODY = 'ISOLATED-SECRET-TEMPLATE';

describe('Page.findTemplate', () => {
  let Page: PageModel;
  let groupMember: IUserHasId;
  let nonMember: IUserHasId;

  const createTemplatePage = async (
    path: string,
    body: string,
    grant: Partial<IPage>,
    creator: IUserHasId,
  ): Promise<void> => {
    const pageId = new mongoose.Types.ObjectId();
    const revisionId = new mongoose.Types.ObjectId();
    await prisma.revisions.create({
      data: {
        id: revisionId.toString(),
        pageId: pageId.toString(),
        body,
        format: 'markdown',
        authorId: creator._id.toString(),
      },
    });
    await Page.create({
      _id: pageId,
      path,
      revision: revisionId,
      creator: creator._id,
      lastUpdateUser: creator._id,
      ...grant,
    });
  };

  beforeAll(async () => {
    const crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    const { User } = crowi.models;

    groupMember = await User.create({
      name: 'Find Template Member',
      username: `${USERNAME_PREFIX}member`,
      email: `${USERNAME_PREFIX}member@example.com`,
    });
    nonMember = await User.create({
      name: 'Find Template Non Member',
      username: `${USERNAME_PREFIX}non-member`,
      email: `${USERNAME_PREFIX}non-member@example.com`,
    });

    const group = await UserGroup.create({ name: `${USERNAME_PREFIX}group` });
    await UserGroupRelation.create({
      relatedGroup: group._id,
      relatedUser: groupMember._id,
    });
    const groupOnly: Partial<IPage> = {
      grant: Page.GRANT_USER_GROUP,
      grantedGroups: [{ item: group._id, type: 'UserGroup' }],
    };
    const publicGrant: Partial<IPage> = { grant: Page.GRANT_PUBLIC };

    await createTemplatePage(
      `${PATH_PREFIX}/__template`,
      PUBLIC_ANCESTOR_TEMPLATE_BODY,
      publicGrant,
      groupMember,
    );
    await createTemplatePage(
      `${PATH_PREFIX}/secret/_template`,
      SECRET_CHILDREN_TEMPLATE_BODY,
      groupOnly,
      groupMember,
    );
    await createTemplatePage(
      `${PATH_PREFIX}/public/_template`,
      PUBLIC_CHILDREN_TEMPLATE_BODY,
      publicGrant,
      groupMember,
    );
    await createTemplatePage(
      `${PATH_PREFIX}-isolated/secret/_template`,
      ISOLATED_SECRET_TEMPLATE_BODY,
      groupOnly,
      groupMember,
    );
  }, 120_000);

  afterAll(async () => {
    const { User } = (await getInstance()).models;

    const pathPattern = new RegExp(`^${PATH_PREFIX}`);
    const pages = await Page.find({ path: pathPattern }).select('_id');
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pages.map((p) => p._id.toString()) } },
    });
    await Page.deleteMany({ path: pathPattern });

    await UserGroupRelation.deleteMany({ relatedUser: groupMember._id });
    await UserGroup.deleteMany({ name: `${USERNAME_PREFIX}group` });
    await User.deleteMany({ username: new RegExp(`^${USERNAME_PREFIX}`) });
  });

  it('applies a group-restricted _template to a creator who belongs to the group', async () => {
    const result = await Page.findTemplate(
      `${PATH_PREFIX}/secret/new-page`,
      groupMember,
    );

    expect(result.templateBody).toBe(SECRET_CHILDREN_TEMPLATE_BODY);
  });

  it('falls back to the nearest visible __template when the creator cannot view the _template', async () => {
    const result = await Page.findTemplate(
      `${PATH_PREFIX}/secret/new-page`,
      nonMember,
    );

    expect(result.templateBody).toBe(PUBLIC_ANCESTOR_TEMPLATE_BODY);
  });

  it('applies no template when the only candidate is not viewable by the creator', async () => {
    const result = await Page.findTemplate(
      `${PATH_PREFIX}-isolated/secret/new-page`,
      nonMember,
    );

    expect(result.templateBody).toBeUndefined();
    expect(result.templateTags).toBeUndefined();
  });

  it('applies a public _template to any creator', async () => {
    const result = await Page.findTemplate(
      `${PATH_PREFIX}/public/new-page`,
      nonMember,
    );

    expect(result.templateBody).toBe(PUBLIC_CHILDREN_TEMPLATE_BODY);
  });
});
