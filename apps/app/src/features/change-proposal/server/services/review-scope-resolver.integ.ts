import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import type {
  OperationRecord,
  OperationStatus,
  ViewerRole,
} from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import { resolveReviewScope } from './review-scope-resolver';
import { loadViewerIdentity } from './reviewer-identity';

const PREFIX = '/cp-review-scope-resolver-integ';

type Access =
  | 'public'
  | 'link'
  | 'member-group'
  | 'member-external-group'
  | 'foreign-group'
  | 'owner';

describe('resolveReviewScope', () => {
  let Page: PageModel;
  let reviewer: HydratedDocument<IUserHasId>;
  let identity: ViewerIdentity;
  const groups = { member: '', foreign: '', external: '' };
  let seq = 0;

  const grantOf = (access: Access) => {
    switch (access) {
      case 'public':
        return { grant: PageGrant.GRANT_PUBLIC };
      case 'link':
        return { grant: PageGrant.GRANT_RESTRICTED };
      case 'owner':
        return {
          grant: PageGrant.GRANT_OWNER,
          grantedUsers: [reviewer._id],
        };
      case 'member-group':
      case 'foreign-group':
        return {
          grant: PageGrant.GRANT_USER_GROUP,
          grantedGroups: [
            {
              item: access === 'member-group' ? groups.member : groups.foreign,
              type: GroupType.userGroup,
            },
          ],
        };
      case 'member-external-group':
        return {
          grant: PageGrant.GRANT_USER_GROUP,
          grantedGroups: [
            { item: groups.external, type: GroupType.externalUserGroup },
          ],
        };
    }
  };

  const createPage = (
    access: Access,
    path?: string,
    isEmpty = false,
  ): Promise<HydratedDocument<PageDocument>> => {
    seq += 1;
    return Page.create({
      path: path ?? `${PREFIX}/page-${seq}`,
      isEmpty,
      ...grantOf(access),
    });
  };

  const idOf = (page: HydratedDocument<PageDocument>): string =>
    page._id.toString();

  const editOf = (
    key: string,
    page: HydratedDocument<PageDocument>,
    status: OperationStatus = 'pending',
  ): OperationRecord => ({
    index: 0,
    key,
    status,
    type: 'edit',
    pageId: idOf(page),
    baseRevisionId: new mongoose.Types.ObjectId().toString(),
    body: 'proposed body',
  });

  const createOf = (
    key: string,
    path: string,
    status: OperationStatus = 'pending',
    resultPageId?: string,
  ): OperationRecord => ({
    index: 0,
    key,
    status,
    type: 'create',
    path,
    body: 'proposed body',
    ...(resultPageId == null ? {} : { resultPageId }),
  });

  const moveOf = (
    key: string,
    source: HydratedDocument<PageDocument>,
    toPath: string,
  ): OperationRecord => ({
    index: 0,
    key,
    status: 'pending',
    type: 'move',
    pageId: idOf(source),
    fromPath: source.path,
    toPath,
  });

  const resolve = async (
    operations: readonly OperationRecord[],
    role: ViewerRole = 'reviewer',
  ) => {
    const result = await resolveReviewScope(operations, identity, role);
    return {
      visible: [...result.visibleKeys].sort(),
      targets: [...result.reviewTargetKeys].sort(),
      stage: result.visibleStage,
    };
  };

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }
    reviewer = await mongoose.model<IUserHasId>('User').create({
      name: 'cpScopeReviewer',
      username: 'cpScopeReviewer',
      email: 'cpScopeReviewer@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
    groups.member = (
      await UserGroup.create({ name: 'cpScopeMemberGroup' })
    )._id.toString();
    groups.foreign = (
      await UserGroup.create({ name: 'cpScopeForeignGroup' })
    )._id.toString();
    groups.external = (
      await ExternalUserGroup.create({
        name: 'cpScopeExternalGroup',
        externalId: 'cp-scope-external',
        provider: 'ldap',
      })
    )._id.toString();
    await UserGroupRelation.create({
      relatedGroup: groups.member,
      relatedUser: reviewer._id,
    });
    await ExternalUserGroupRelation.create({
      relatedGroup: groups.external,
      relatedUser: reviewer._id,
    });
    identity = await loadViewerIdentity(reviewer._id.toString());
  });

  afterAll(async () => {
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}(/|$)`) });
    await UserGroupRelation.deleteMany({
      relatedGroup: { $in: [groups.member, groups.foreign] },
    });
    await ExternalUserGroupRelation.deleteMany({
      relatedGroup: groups.external,
    });
    await UserGroup.deleteMany({
      _id: { $in: [groups.member, groups.foreign] },
    });
    await ExternalUserGroup.deleteMany({ _id: groups.external });
    await mongoose.model('User').deleteMany({ _id: reviewer._id });
  });

  describe('a pending edit', () => {
    it('is a decision target when the reviewer can view the page through a group, an external group or ownership (Req 16.2, 19.6)', async () => {
      const ops = [
        editOf('group', await createPage('member-group')),
        editOf('external', await createPage('member-external-group')),
        editOf('owner', await createPage('owner')),
      ];

      expect(await resolve(ops)).toEqual({
        visible: ['external', 'group', 'owner'],
        targets: ['external', 'group', 'owner'],
        stage: 'open',
      });
    });

    it('is absent when the page belongs to a group the reviewer is not in (Req 16.6, 19.4)', async () => {
      const ops = [editOf('foreign', await createPage('foreign-group'))];

      expect(await resolve(ops)).toEqual({
        visible: [],
        targets: [],
        stage: 'settled',
      });
    });

    it('is judged by the membership read for this request, not read again (Req 19.9)', async () => {
      const ops = [editOf('group', await createPage('member-group'))];
      const withoutGroups: ViewerIdentity = {
        ...identity,
        userGroupIds: new Set(),
      };

      const result = await resolveReviewScope(ops, withoutGroups, 'reviewer');

      expect([...result.visibleKeys]).toEqual([]);
    });
  });

  describe('"anyone with the link" pages', () => {
    it('keep every operation that rests on one away from the reviewer (Req 19.6)', async () => {
      const linkParent = await createPage('link');
      const publicParent = await createPage('public');
      const ops = [
        editOf('edit-target', await createPage('link')),
        createOf('create-parent', `${linkParent.path}/new`),
        moveOf(
          'move-destination',
          await createPage('public'),
          `${linkParent.path}/moved`,
        ),
        moveOf(
          'move-source',
          await createPage('link'),
          `${publicParent.path}/moved`,
        ),
        moveOf(
          'move-ok',
          await createPage('public'),
          `${publicParent.path}/moved-ok`,
        ),
      ];

      expect((await resolve(ops)).visible).toEqual(['move-ok']);
    });
  });

  describe('pages that share the closest ancestor path', () => {
    // Pages outside the tree (parent: null) are not kept unique by path.
    it('hide a create or a move when the reviewer cannot view one of them (Req 19.6)', async () => {
      const foreign = await createPage('foreign-group');
      await createPage('public', foreign.path);
      const ops = [
        createOf('create', `${foreign.path}/new`),
        moveOf('move', await createPage('public'), `${foreign.path}/moved`),
      ];

      expect((await resolve(ops)).visible).toEqual([]);
    });

    it('show them when the reviewer can view every one (Req 16.2)', async () => {
      const grouped = await createPage('member-group');
      await createPage('public', grouped.path);

      expect(
        (await resolve([createOf('create', `${grouped.path}/new`)])).visible,
      ).toEqual(['create']);
    });
  });

  describe('the parent of a page that does not exist yet', () => {
    it('skips an empty page and judges by the closest non-empty ancestor (Req 16.2, 19.6)', async () => {
      const grandparent = await createPage('public');
      const emptyParent = await createPage(
        'public',
        `${grandparent.path}/empty`,
        true,
      );

      expect(
        await resolve([createOf('create', `${emptyParent.path}/new`)]),
      ).toEqual({ visible: ['create'], targets: ['create'], stage: 'open' });
    });

    it('does not let a viewable empty page stand in for an ancestor the reviewer cannot view (Req 19.6)', async () => {
      const grandparent = await createPage('foreign-group');
      const emptyParent = await createPage(
        'public',
        `${grandparent.path}/empty`,
        true,
      );

      expect(
        (await resolve([createOf('create', `${emptyParent.path}/new`)]))
          .visible,
      ).toEqual([]);
    });

    it('is the closest one, not a farther ancestor the reviewer can view (Req 19.6)', async () => {
      const top = await createPage('public');
      const middle = await createPage('foreign-group', `${top.path}/middle`);

      expect(
        (await resolve([createOf('create', `${middle.path}/new`)])).visible,
      ).toEqual([]);
    });
  });

  describe('operations already applied', () => {
    it('are decided by the rule for other viewers, on the page the operation produced (Req 19.10)', async () => {
      const parent = await createPage('public');
      const created = await createPage('foreign-group', `${parent.path}/made`);
      const ops = [
        createOf('applied-create', created.path, 'applied', idOf(created)),
        createOf('pending-create', `${parent.path}/waiting`),
        editOf('applied-public', await createPage('public'), 'applied'),
        editOf('applied-link', await createPage('link'), 'applied'),
      ];

      expect((await resolve(ops)).visible).toEqual([
        'applied-public',
        'pending-create',
      ]);
    });
  });

  describe('the visible stage', () => {
    it('reveals nothing about a pending operation the reviewer cannot view (Req 19.6)', async () => {
      const ops = [
        editOf('seen', await createPage('public'), 'failed'),
        editOf('hidden', await createPage('foreign-group'), 'pending'),
      ];

      expect(await resolve(ops)).toEqual({
        visible: ['seen'],
        targets: [],
        stage: 'settled',
      });
    });
  });

  describe('a viewer who is neither requester nor reviewer', () => {
    it('sees only applied operations, as before (Req 19.10)', async () => {
      const page = await createPage('public');
      const ops = [editOf('pending', page), editOf('applied', page, 'applied')];

      expect(await resolve(ops, 'other')).toEqual({
        visible: ['applied'],
        targets: [],
        stage: 'settled',
      });
    });
  });
});
