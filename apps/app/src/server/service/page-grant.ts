import type { IPage, IUserHasId, IUser } from '@growi/core';
import {
  type IGrantedGroup,
  PageGrant, GroupType, getIdForRef,
} from '@growi/core';
import {
  pagePathUtils, pathUtils, pageUtils,
} from '@growi/core/dist/utils';
import escapeStringRegexp from 'escape-string-regexp';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { ExternalGroupProviderType } from '~/features/external-user-group/interfaces/external-user-group';
import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { UserRelatedGroupsData } from '~/interfaces/page';
import { UserGroupPageGrantStatus, type GroupGrantData } from '~/interfaces/page';
import type { IRecordApplicableGrant, PopulatedGrantedGroup } from '~/interfaces/page-grant';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import { includesObjectIds, excludeTestIdsFromTargetIds, hasIntersection } from '~/server/util/compare-objectId';

import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import UserGroupRelation from '../models/user-group-relation';
import { divideByType } from '../util/granted-group';

const { addTrailingSlash } = pathUtils;
const { isTopPage } = pagePathUtils;

const LIMIT_FOR_MULTIPLE_PAGE_OP = 20;

type ComparableTarget = {
  grant?: number,
  grantedUserIds?: ObjectIdLike[],
  grantedGroupIds?: IGrantedGroup[],
  applicableUserIds?: ObjectIdLike[],
  applicableGroupIds?: ObjectIdLike[],
};

type ComparableAncestor = {
  grant: number,
  grantedUserIds: ObjectIdLike[],
  applicableUserIds?: ObjectIdLike[],
  applicableGroupIds?: ObjectIdLike[],
};

type ComparableDescendants = {
  isPublicExist: boolean,
  grantedUserIds: ObjectIdLike[],
  grantedGroupIds: IGrantedGroup[],
};

/**
 * @param grantedUserGroupInfo This parameter has info to calculate whether the update operation is allowed.
 *   - See the `calcCanOverwriteDescendants` private method for detail.
 */
type UpdateGrantInfo = {
  grant: typeof PageGrant.GRANT_PUBLIC,
} | {
  grant: typeof PageGrant.GRANT_OWNER,
  grantedUserId: ObjectIdLike,
} | {
  grant: typeof PageGrant.GRANT_USER_GROUP,
  grantedUserGroupInfo: {
    userIds: Set<ObjectIdLike>,
    childrenOrItselfGroupIds: Set<ObjectIdLike>,
  },
};

type DescendantPagesGrantInfo = {
  grantSet: Set<number>,
  grantedUserIds: Set<ObjectIdLike>, // all only me users of descendant pages
  grantedUserGroupIds: Set<ObjectIdLike>, // all user groups of descendant pages
};

/**
 * @param {ObjectIdLike} userId The _id of the operator.
 * @param {Set<ObjectIdLike>} userGroupIds The Set of the _id of the user groups that the operator belongs.
 */
type OperatorGrantInfo = {
  userId: ObjectIdLike,
  userGroupIds: Set<ObjectIdLike>,
};

export interface IPageGrantService {
  isGrantNormalized: (
    user,
    targetPath: string,
    grant?: PageGrant,
    grantedUserIds?: ObjectIdLike[],
    grantedGroupIds?: IGrantedGroup[],
    shouldCheckDescendants?: boolean,
    includeNotMigratedPages?: boolean,
    previousGrantedGroupIds?: IGrantedGroup[]
  ) => Promise<boolean>,
  separateNormalizableAndNotNormalizablePages: (user, pages) => Promise<[(PageDocument & { _id: any })[], (PageDocument & { _id: any })[]]>,
  generateUpdateGrantInfoToOverwriteDescendants: (
    operator, updateGrant?: PageGrant, grantGroupIds?: IGrantedGroup[],
  ) => Promise<UpdateGrantInfo>,
  canOverwriteDescendants: (targetPath: string, operator: { _id: ObjectIdLike }, updateGrantInfo: UpdateGrantInfo) => Promise<boolean>,
  validateGrantChange: (user, previousGrantedGroupIds: IGrantedGroup[], grant?: PageGrant, grantedGroupIds?: IGrantedGroup[]) => Promise<boolean>,
  validateGrantChangeSyncronously:(
    userRelatedGroups: PopulatedGrantedGroup[], previousGrantedGroups: IGrantedGroup[], grant?: PageGrant, grantedGroups?: IGrantedGroup[],
  ) => boolean,
  getUserRelatedGroups: (user?: IUserHasId | HydratedDocument<IUser> | null) => Promise<PopulatedGrantedGroup[]>,
  getPopulatedGrantedGroups: (grantedGroups: IGrantedGroup[]) => Promise<PopulatedGrantedGroup[]>,
  getUserRelatedGrantedGroups: (page: PageDocument, user) => Promise<IGrantedGroup[]>,
  getUserRelatedGrantedGroupsSyncronously: (userRelatedGroups: PopulatedGrantedGroup[], page: PageDocument) => IGrantedGroup[],
  getNonUserRelatedGrantedGroups: (page: PageDocument, user) => Promise<IGrantedGroup[]>,
  isUserGrantedPageAccess: (page: PageDocument, user, userRelatedGroups: PopulatedGrantedGroup[], allowAnyoneWithTheLink?: boolean) => boolean,
  getPageGroupGrantData: (page: PageDocument, user) => Promise<GroupGrantData>,
  calcApplicableGrantData: (page, user) => Promise<IRecordApplicableGrant>
}

class PageGrantService implements IPageGrantService {

  crowi!: any;

  constructor(crowi: any) {
    this.crowi = crowi;
  }

  private validateComparableTarget(comparable: ComparableTarget) {
    const Page = mongoose.model<IPage, PageModel>('Page');

    const { grant, grantedUserIds, grantedGroupIds } = comparable;

    if (grant === Page.GRANT_OWNER && (grantedUserIds == null || grantedUserIds.length !== 1)) {
      throw Error('grantedUserIds must not be null and must have 1 length');
    }
    if (grant === Page.GRANT_USER_GROUP && grantedGroupIds == null) {
      throw Error('grantedGroupIds is not specified');
    }
  }

  /**
   * About the rule of validation, see: https://dev.growi.org/61b2cdabaa330ce7d8152844
   * @returns boolean
   */
  private validateGrant(target: ComparableTarget, ancestor: ComparableAncestor, descendants?: ComparableDescendants): boolean {
    /*
     * the page itself
     */
    this.validateComparableTarget(target);

    const Page = mongoose.model<IPage, PageModel>('Page');

    /*
     * ancestor side
     */
    // GRANT_PUBLIC
    if (ancestor.grant === Page.GRANT_PUBLIC) { // any page can exist under public page
      // do nothing
    }
    // GRANT_OWNER
    else if (ancestor.grant === Page.GRANT_OWNER) {
      if (target.grantedUserIds?.length !== 1) {
        return false;
      }

      if (target.grant !== Page.GRANT_OWNER) { // only GRANT_OWNER page can exist under GRANT_OWNER page
        return false;
      }

      if (ancestor.grantedUserIds[0].toString() !== target.grantedUserIds[0].toString()) { // the grantedUser must be the same as parent's under the GRANT_OWNER page
        return false;
      }
    }
    // GRANT_USER_GROUP
    else if (ancestor.grant === Page.GRANT_USER_GROUP) {
      if (ancestor.applicableGroupIds == null || ancestor.applicableUserIds == null) {
        throw Error('applicableGroupIds and applicableUserIds are not specified');
      }

      if (target.grant === Page.GRANT_PUBLIC) { // public page must not exist under GRANT_USER_GROUP page
        return false;
      }

      if (target.grant === Page.GRANT_OWNER) {
        if (target.grantedUserIds?.length !== 1) {
          throw Error('grantedUserIds must have one user');
        }

        if (!includesObjectIds(ancestor.applicableUserIds, [target.grantedUserIds[0]])) { // GRANT_OWNER pages under GRAND_USER_GROUP page must be owned by the member of the grantedGroup of the GRAND_USER_GROUP page
          return false;
        }
      }

      if (target.grant === Page.GRANT_USER_GROUP) {
        if (target.grantedGroupIds == null || target.grantedGroupIds.length === 0) {
          throw Error('grantedGroupId must not be empty');
        }
        const targetGrantedGroupStrIds = target.grantedGroupIds.map(e => (typeof e.item === 'string' ? e.item : e.item._id));
        if (!includesObjectIds(ancestor.applicableGroupIds, targetGrantedGroupStrIds)) { // only child groups or the same group can exist under GRANT_USER_GROUP page
          return false;
        }
      }
    }

    if (descendants == null) {
      return true;
    }
    /*
     * descendant side
     */

    // GRANT_PUBLIC
    if (target.grant === Page.GRANT_PUBLIC) { // any page can exist under public page
      // do nothing
    }
    // GRANT_OWNER
    else if (target.grant === Page.GRANT_OWNER) {
      if (target.grantedUserIds?.length !== 1) {
        throw Error('grantedUserIds must have one user');
      }

      if (descendants.isPublicExist) { // public page must not exist under GRANT_OWNER page
        return false;
      }

      if (descendants.grantedGroupIds.length !== 0 || descendants.grantedUserIds.length > 1) { // groups or more than 2 grantedUsers must not be in descendants
        return false;
      }

      if (descendants.grantedUserIds.length === 1 && descendants.grantedUserIds[0].toString() !== target.grantedUserIds[0].toString()) { // if Only me page exists, then all of them must be owned by the same user as the target page
        return false;
      }
    }
    // GRANT_USER_GROUP
    else if (target.grant === Page.GRANT_USER_GROUP) {
      if (target.applicableGroupIds == null || target.applicableUserIds == null) {
        throw Error('applicableGroupIds and applicableUserIds must not be null');
      }

      if (descendants.isPublicExist) { // public page must not exist under GRANT_USER_GROUP page
        return false;
      }

      const shouldNotExistGroupIds = excludeTestIdsFromTargetIds(descendants.grantedGroupIds.map(g => g.item), target.applicableGroupIds);
      const shouldNotExistUserIds = excludeTestIdsFromTargetIds(descendants.grantedUserIds, target.applicableUserIds);
      if (shouldNotExistGroupIds.length !== 0 || shouldNotExistUserIds.length !== 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate if page grant can be changed from prior grant to specified grant.
   * Necessary for pages with multiple group grant.
   * see: https://dev.growi.org/656745fa52eafe1cf1879508#%E3%83%9A%E3%83%BC%E3%82%B8%E3%81%AE-grant-%E3%81%AE%E6%9B%B4%E6%96%B0
   * @param user The user who is changing the grant
   * @param previousGrantedGroups The groups that were granted priorly
   * @param grant The grant to be changed to
   * @param grantedGroups The groups to be granted
   */
  async validateGrantChange(user, previousGrantedGroups: IGrantedGroup[], grant?: PageGrant, grantedGroups?: IGrantedGroup[]): Promise<boolean> {
    const userRelatedGroups = await this.getUserRelatedGroups(user);
    return this.validateGrantChangeSyncronously(userRelatedGroups, previousGrantedGroups, grant, grantedGroups);
  }

  /**
   * Use when you do not want to use validateGrantChange with async/await (e.g inside loops that process a large amount of pages)
   * Specification of userRelatedGroups is necessary to avoid the cost of fetching userRelatedGroups from DB every time.
   */
  validateGrantChangeSyncronously(
      userRelatedGroups: PopulatedGrantedGroup[],
      previousGrantedGroups: IGrantedGroup[],
      grant?: PageGrant,
      grantedGroups?: IGrantedGroup[],
  ): boolean {
    const userRelatedGroupIds = userRelatedGroups.map(g => g.item._id);
    const userBelongsToAllPreviousGrantedGroups = excludeTestIdsFromTargetIds(
      previousGrantedGroups.map(g => getIdForRef(g.item)),
      userRelatedGroupIds,
    ).length === 0;

    if (!userBelongsToAllPreviousGrantedGroups) {
      if (grant !== PageGrant.GRANT_USER_GROUP) {
        return false;
      }
      const pageGrantIncludesUserRelatedGroup = hasIntersection(grantedGroups?.map(g => getIdForRef(g.item)) || [], userRelatedGroupIds);
      if (!pageGrantIncludesUserRelatedGroup) {
        return false;
      }
    }

    return true;
  }

  /**
   * Prepare ComparableTarget
   * @returns Promise<ComparableAncestor>
   */
  private async generateComparableTargetWithApplicableData(
      grant: PageGrant | undefined, grantedUserIds: ObjectIdLike[] | undefined, grantedGroupIds: IGrantedGroup[] | undefined,
  ): Promise<ComparableTarget> {
    const Page = mongoose.model<IPage, PageModel>('Page');

    let applicableUserIds: ObjectIdLike[] | undefined;
    let applicableGroupIds: ObjectIdLike[] | undefined;

    if (grant === Page.GRANT_USER_GROUP) {
      if (grantedGroupIds == null || grantedGroupIds.length === 0) {
        throw Error('Target user group is not given');
      }

      const { grantedUserGroups: grantedUserGroupIds, grantedExternalUserGroups: grantedExternalUserGroupIds } = divideByType(grantedGroupIds);
      const targetUserGroups = await UserGroup.find({ _id: { $in: grantedUserGroupIds } });
      const targetExternalUserGroups = await ExternalUserGroup.find({ _id: { $in: grantedExternalUserGroupIds } });
      if (targetUserGroups.length === 0 && targetExternalUserGroups.length === 0) {
        throw Error('Target user group does not exist');
      }

      const userGroupRelations = await UserGroupRelation.find({ relatedGroup: { $in: targetUserGroups.map(g => g._id) } });
      const externalUserGroupRelations = await ExternalUserGroupRelation.find({ relatedGroup: { $in: targetExternalUserGroups.map(g => g._id) } });
      applicableUserIds = Array.from(new Set([...userGroupRelations, ...externalUserGroupRelations].map(u => u.relatedUser as ObjectIdLike)));

      const applicableUserGroups = (await Promise.all(targetUserGroups.map((group) => {
        return UserGroup.findGroupsWithDescendantsById(group._id);
      }))).flat();
      const applicableExternalUserGroups = (await Promise.all(targetExternalUserGroups.map((group) => {
        return ExternalUserGroup.findGroupsWithDescendantsById(group._id);
      }))).flat();
      applicableGroupIds = [...applicableUserGroups, ...applicableExternalUserGroups].map(g => g._id);
    }

    return {
      grant,
      grantedUserIds,
      grantedGroupIds,
      applicableUserIds,
      applicableGroupIds,
    };
  }

  /**
   * Prepare ComparableAncestor
   * @param targetPath string of the target path
   * @returns Promise<ComparableAncestor>
   */
  private async generateComparableAncestor(targetPath: string, includeNotMigratedPages: boolean): Promise<ComparableAncestor> {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    let applicableUserIds: ObjectIdLike[] | undefined;
    let applicableGroupIds: ObjectIdLike[] | undefined;

    /*
     * make granted users list of ancestor's
     */
    const builderForAncestors = new PageQueryBuilder(Page.find(), false);
    if (!includeNotMigratedPages) {
      builderForAncestors.addConditionAsOnTree();
    }
    const ancestors = await builderForAncestors
      .addConditionToListOnlyAncestors(targetPath)
      .addConditionToSortPagesByDescPath()
      .query
      .exec();
    const testAncestor = ancestors[0]; // TODO: consider when duplicate testAncestors exist
    if (testAncestor == null) {
      throw Error('testAncestor must exist');
    }

    if (testAncestor.grant === Page.GRANT_USER_GROUP) {
      // make a set of all users
      const { grantedUserGroups, grantedExternalUserGroups } = divideByType(testAncestor.grantedGroups);

      const userGroupRelations = await UserGroupRelation.find({ relatedGroup: { $in: grantedUserGroups } }, { _id: 0, relatedUser: 1 });
      const externalUserGroupRelations = await ExternalUserGroupRelation.find({ relatedGroup: { $in: grantedExternalUserGroups } }, { _id: 0, relatedUser: 1 });
      applicableUserIds = Array.from(new Set([...userGroupRelations, ...externalUserGroupRelations].map(r => r.relatedUser as ObjectIdLike)));

      const applicableUserGroups = (await Promise.all(grantedUserGroups.map((groupId) => {
        return UserGroup.findGroupsWithDescendantsById(groupId);
      }))).flat();
      const applicableExternalUserGroups = (await Promise.all(grantedExternalUserGroups.map((groupId) => {
        return ExternalUserGroup.findGroupsWithDescendantsById(groupId);
      }))).flat();
      applicableGroupIds = [...applicableUserGroups, ...applicableExternalUserGroups].map(g => g._id);

    }

    return {
      grant: testAncestor.grant,
      grantedUserIds: testAncestor.grantedUsers,
      applicableUserIds,
      applicableGroupIds,
    };
  }

  /**
   * Prepare ComparableDescendants
   * @param targetPath string of the target path
   * @returns ComparableDescendants
   */
  private async generateComparableDescendants(targetPath: string, user, includeNotMigratedPages = false): Promise<ComparableDescendants> {
    const Page = mongoose.model<IPage, PageModel>('Page');

    // Build conditions
    const $match: {$or: any} = {
      $or: [],
    };

    const commonCondition = {
      path: new RegExp(`^${escapeStringRegexp(addTrailingSlash(targetPath))}`, 'i'),
      isEmpty: false,
    };

    const conditionForNormalizedPages: any = {
      ...commonCondition,
      parent: { $ne: null },
    };
    $match.$or.push(conditionForNormalizedPages);

    if (includeNotMigratedPages) {
      // Add grantCondition for not normalized pages
      const userGroups = [
        ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
        ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
      ];
      const grantCondition = Page.generateGrantCondition(user, userGroups);
      const conditionForNotNormalizedPages = {
        $and: [
          {
            ...commonCondition,
            parent: null,
          },
          grantCondition,
        ],
      };
      $match.$or.push(conditionForNotNormalizedPages);
    }

    const result = await Page.aggregate([
      { // match to descendants excluding empty pages
        $match,
      },
      {
        $project: {
          _id: 0,
          grant: 1,
          grantedUsers: 1,
          grantedGroups: 1,
        },
      },
      {
        $unwind: { // preprocess for creating groups set
          path: '$grantedGroups',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: { // preprocess for creating users set
          path: '$grantedUsersSet',
          preserveNullAndEmptyArrays: true,
        },
      },
      { // remove duplicates from pipeline
        $group: {
          _id: '$grant',
          grantedGroupsSet: { $addToSet: '$grantedGroups' },
          grantedUsersSet: { $addToSet: '$grantedUsers' },
        },
      },
    ]);

    // GRANT_PUBLIC group
    const isPublicExist = result.some(r => r._id === Page.GRANT_PUBLIC);
    // GRANT_OWNER group
    const grantOwnerResult = result.filter(r => r._id === Page.GRANT_OWNER)[0]; // users of GRANT_OWNER
    const grantedUserIds: ObjectIdLike[] = grantOwnerResult?.grantedUsersSet ?? [];
    // GRANT_USER_GROUP group
    const grantUserGroupResult = result.filter(r => r._id === Page.GRANT_USER_GROUP)[0]; // users of GRANT_OWNER
    const grantedGroupIds = grantUserGroupResult?.grantedGroupsSet ?? [];

    return {
      isPublicExist,
      grantedUserIds,
      grantedGroupIds,
    };
  }

  /**
   * About the rule of validation, see: https://dev.growi.org/61b2cdabaa330ce7d8152844
   * Only v5 schema pages will be used to compare by default (Set includeNotMigratedPages to true to include v4 schema pages as well).
   * When comparing, it will use path regex to collect pages instead of using parent attribute of the Page model. This is reasonable since
   * using the path attribute is safer than using the parent attribute in this case. 2022.02.13 -- Taichi Masuyama
   * @param user The user responsible for execution
   * @param targetPath Path of page which grant will be validated
   * @param grant Type of the grant to be validated
   * @param grantedUserIds Users of grant to be validated
   * @param grantedGroupIds Groups of grant to be validated
   * @param shouldCheckDescendants Whether or not to use descendant grant for validation
   * @param includeNotMigratedPages Whether or not to use unmigrated pages for validation
   * @param previousGrantedGroupIds
   *   Previously granted groups of the page. Specific validation is required when previous grant is multiple group grant.
   *   Apply when page grant change needs to be validated.
   *   see: https://dev.growi.org/656745fa52eafe1cf1879508#%E3%83%9A%E3%83%BC%E3%82%B8%E3%81%AE-grant-%E3%81%AE%E6%9B%B4%E6%96%B0
   * @returns Promise<boolean>
   */
  async isGrantNormalized(
      user,
      targetPath: string,
      grant?: PageGrant,
      grantedUserIds?: ObjectIdLike[],
      grantedGroupIds?: IGrantedGroup[],
      shouldCheckDescendants = false,
      includeNotMigratedPages = false,
  ): Promise<boolean> {
    if (isTopPage(targetPath)) {
      return true;
    }

    const comparableAncestor = await this.generateComparableAncestor(targetPath, includeNotMigratedPages);

    if (!shouldCheckDescendants) { // checking the parent is enough
      const comparableTarget: ComparableTarget = { grant, grantedUserIds, grantedGroupIds };
      return this.validateGrant(comparableTarget, comparableAncestor);
    }

    const comparableTarget = await this.generateComparableTargetWithApplicableData(grant, grantedUserIds, grantedGroupIds);
    const comparableDescendants = await this.generateComparableDescendants(targetPath, user, includeNotMigratedPages);

    return this.validateGrant(comparableTarget, comparableAncestor, comparableDescendants);
  }

  /**
   * Separate normalizable pages and NOT normalizable pages by PageService.prototype.isGrantNormalized method.
   * normalizable pages = Pages which are able to run normalizeParentRecursively method (grant & userGroup rule is correct)
   * @param pageIds pageIds to be tested
   * @returns a tuple with the first element of normalizable pages and the second element of NOT normalizable pages
   */
  async separateNormalizableAndNotNormalizablePages(user, pages): Promise<[(PageDocument & { _id: any })[], (PageDocument & { _id: any })[]]> {
    if (pages.length > LIMIT_FOR_MULTIPLE_PAGE_OP) {
      throw Error(`The maximum number of pageIds allowed is ${LIMIT_FOR_MULTIPLE_PAGE_OP}.`);
    }

    const shouldCheckDescendants = true;
    const shouldIncludeNotMigratedPages = true;

    const normalizable: (PageDocument & { _id: any })[] = [];
    const nonNormalizable: (PageDocument & { _id: any })[] = []; // can be used to tell user which page failed to migrate

    for await (const page of pages) {
      const {
        path, grant, grantedUsers: grantedUserIds, grantedGroups: grantedGroupIds,
      } = page;

      if (!pageUtils.isPageNormalized(page)) {
        nonNormalizable.push(page);
        continue;
      }

      if (await this.isGrantNormalized(user, path, grant, grantedUserIds, grantedGroupIds, shouldCheckDescendants, shouldIncludeNotMigratedPages)) {
        normalizable.push(page);
      }
      else {
        nonNormalizable.push(page);
      }
    }

    return [normalizable, nonNormalizable];
  }

  async calcApplicableGrantData(page, user): Promise<IRecordApplicableGrant> {
    const Page = mongoose.model<IPage, PageModel>('Page');

    // -- Public only if top page
    const isOnlyPublicApplicable = isTopPage(page.path);
    if (isOnlyPublicApplicable) {
      return {
        [PageGrant.GRANT_PUBLIC]: null,
      };
    }

    // Increment an object (type IRecordApplicableGrant)
    // grant is never public, anyone with the link, nor specified
    const data: IRecordApplicableGrant = {
      [PageGrant.GRANT_RESTRICTED]: null, // any page can be restricted
    };

    const userRelatedGroups = await this.getUserRelatedGroups(user);

    // -- Any grant is allowed if parent is null
    const isAnyGrantApplicable = page.parent == null;
    if (isAnyGrantApplicable) {
      data[PageGrant.GRANT_PUBLIC] = null;
      data[PageGrant.GRANT_OWNER] = null;
      data[PageGrant.GRANT_USER_GROUP] = { applicableGroups: userRelatedGroups };
      return data;
    }

    const parent = await Page.findById(page.parent);
    if (parent == null) {
      throw Error('The page\'s parent does not exist.');
    }

    const {
      grant, grantedUsers, grantedGroups,
    } = parent;

    if (grant === PageGrant.GRANT_PUBLIC) {
      data[PageGrant.GRANT_PUBLIC] = null;
      data[PageGrant.GRANT_OWNER] = null;
      data[PageGrant.GRANT_USER_GROUP] = { applicableGroups: userRelatedGroups };
    }
    else if (grant === PageGrant.GRANT_OWNER) {
      const grantedUser = grantedUsers[0];

      const isUserApplicable = grantedUser.toString() === user._id.toString();

      if (isUserApplicable) {
        data[PageGrant.GRANT_OWNER] = null;
      }
    }
    else if (grant === PageGrant.GRANT_USER_GROUP) {
      const { grantedUserGroups: grantedUserGroupIds, grantedExternalUserGroups: grantedExternalUserGroupIds } = divideByType(grantedGroups);
      const targetUserGroups = await UserGroup.find({ _id: { $in: grantedUserGroupIds } });
      const targetExternalUserGroups = await ExternalUserGroup.find({ _id: { $in: grantedExternalUserGroupIds } });
      if (targetUserGroups.length === 0 && targetExternalUserGroups.length === 0) {
        throw Error('Group not found to calculate grant data.');
      }

      const isUserExistInUserGroup = (await Promise.all(targetUserGroups.map((group) => {
        return UserGroupRelation.countByGroupIdsAndUser([group._id], user);
      }))).some(count => count > 0);
      const isUserExistInExternalUserGroup = (await Promise.all(targetExternalUserGroups.map((group) => {
        return ExternalUserGroupRelation.countByGroupIdsAndUser([group._id], user);
      }))).some(count => count > 0);
      const isUserExistInGroup = isUserExistInUserGroup || isUserExistInExternalUserGroup;

      if (isUserExistInGroup) {
        data[PageGrant.GRANT_OWNER] = null;
      }

      const applicableUserGroups = (await Promise.all(targetUserGroups.map((group) => {
        return UserGroupRelation.findGroupsWithDescendantsByGroupAndUser(group, user);
      }))).flat();
      const applicableExternalUserGroups = (await Promise.all(targetExternalUserGroups.map((group) => {
        return ExternalUserGroupRelation.findGroupsWithDescendantsByGroupAndUser(group, user);
      }))).flat();

      const applicableGroups = [
        ...applicableUserGroups.map((group) => {
          return { type: GroupType.userGroup, item: group };
        }),
        ...applicableExternalUserGroups.map((group) => {
          return { type: GroupType.externalUserGroup, item: group };
        }),
      ];
      data[PageGrant.GRANT_USER_GROUP] = { applicableGroups };
    }

    return data;
  }

  /**
   * Get the group grant data of page.
   * To calculate if a group can be granted to page, the same logic as isGrantNormalized will be executed, except only the ancestor info will be used.
   */
  async getPageGroupGrantData(page: PageDocument, user): Promise<GroupGrantData> {
    if (isTopPage(page.path)) {
      return { userRelatedGroups: [], nonUserRelatedGrantedGroups: [] };
    }

    const userRelatedGroups = await this.getUserRelatedGroups(user);
    let userRelatedGroupsData: UserRelatedGroupsData[] = userRelatedGroups.map((group) => {
      const provider = group.type === GroupType.externalUserGroup ? group.item.provider : undefined;
      return {
        // default status as notGranted
        id: group.item._id.toString(), name: group.item.name, type: group.type, provider, status: UserGroupPageGrantStatus.notGranted,
      };
    });

    const nonUserRelatedGrantedGroups: {
      id: string,
      name: string,
      type: GroupType,
      provider?: ExternalGroupProviderType,
    }[] = [];

    const populatedGrantedGroups = await this.getPopulatedGrantedGroups(page.grantedGroups);

    // Set the status of user-related granted groups as isGranted
    // Append non-user-related granted groups to nonUserRelatedGrantedGroups
    populatedGrantedGroups.forEach((group) => {
      const userRelatedGrantedGroup = userRelatedGroupsData.find((userRelatedGroup) => {
        return userRelatedGroup.id === group.item._id.toString();
      });
      if (userRelatedGrantedGroup != null) {
        userRelatedGrantedGroup.status = UserGroupPageGrantStatus.isGranted;
      }
      else {
        const provider = group.type === GroupType.externalUserGroup ? group.item.provider : undefined;
        nonUserRelatedGrantedGroups.push({
          id: group.item._id.toString(), name: group.item.name, type: group.type, provider,
        });
      }
    });

    // Check if group can be granted to page for non-granted groups
    const grantedUserIds = page.grantedUsers?.map(user => getIdForRef(user)) ?? [];
    const comparableAncestor = await this.generateComparableAncestor(page.path, false);
    userRelatedGroupsData = userRelatedGroupsData.map((groupData) => {
      if (groupData.status === UserGroupPageGrantStatus.isGranted) {
        return groupData;
      }
      const groupsToGrant = [...(page.grantedGroups ?? []), { item: groupData.id, type: groupData.type }];
      const comparableTarget: ComparableTarget = {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedUserIds,
        grantedGroupIds: groupsToGrant,
      };
      const status = this.validateGrant(comparableTarget, comparableAncestor) ? UserGroupPageGrantStatus.notGranted : UserGroupPageGrantStatus.cannotGrant;
      return { ...groupData, status };
    });

    const statusPriority = {
      [UserGroupPageGrantStatus.notGranted]: 0,
      [UserGroupPageGrantStatus.isGranted]: 1,
      [UserGroupPageGrantStatus.cannotGrant]: 2,
    };
    userRelatedGroupsData.sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);

    return { userRelatedGroups: userRelatedGroupsData, nonUserRelatedGrantedGroups };
  }

  /*
   * get all groups that user is related to
   */
  async getUserRelatedGroups(user?: IUserHasId | null): Promise<PopulatedGrantedGroup[]> {
    if (user == null) {
      return [];
    }

    const userRelatedUserGroups = await UserGroupRelation.findAllGroupsForUser(user);
    const userRelatedExternalUserGroups = await ExternalUserGroupRelation.findAllGroupsForUser(user);
    return [
      ...userRelatedUserGroups.map((group) => {
        return { type: GroupType.userGroup, item: group };
      }),
      ...userRelatedExternalUserGroups.map((group) => {
        return { type: GroupType.externalUserGroup, item: group };
      }),
    ];
  }

  async getPopulatedGrantedGroups(grantedGroups: IGrantedGroup[]): Promise<PopulatedGrantedGroup[]> {
    const { grantedUserGroups, grantedExternalUserGroups } = divideByType(grantedGroups);
    const userGroupDocuments = await UserGroup.find({ _id: { $in: grantedUserGroups } });
    const externalUserGroupDocuments = await ExternalUserGroup.find({ _id: { $in: grantedExternalUserGroups } });
    return [
      ...(userGroupDocuments.map((group) => {
        return { type: GroupType.userGroup, item: group };
      })),
      ...(externalUserGroupDocuments.map((group) => {
        return { type: GroupType.externalUserGroup, item: group };
      })),
    ];
  }

  /*
   * get all groups of Page that user is related to
   */
  async getUserRelatedGrantedGroups(page: PageDocument, user): Promise<IGrantedGroup[]> {
    const userRelatedGroups = (await this.getUserRelatedGroups(user));
    return this.getUserRelatedGrantedGroupsSyncronously(userRelatedGroups, page);
  }

  /**
   * Use when you do not want to use getUserRelatedGrantedGroups with async/await (e.g inside loops that process a large amount of pages)
   * Specification of userRelatedGroups is necessary to avoid the cost of fetching userRelatedGroups from DB every time.
   */
  getUserRelatedGrantedGroupsSyncronously(userRelatedGroups: PopulatedGrantedGroup[], page: PageDocument): IGrantedGroup[] {
    const userRelatedGroupIds: string[] = userRelatedGroups.map(ug => ug.item._id.toString());
    return page.grantedGroups?.filter((group) => {
      return userRelatedGroupIds.includes(getIdForRef(group.item).toString());
    }) || [];
  }

  /*
   * get all groups of Page that user is not related to
   */
  async getNonUserRelatedGrantedGroups(page: PageDocument, user): Promise<IGrantedGroup[]> {
    const userRelatedGroups = (await this.getUserRelatedGroups(user));
    const userRelatedGroupIds: string[] = userRelatedGroups.map(ug => ug.item._id.toString());
    return page.grantedGroups?.filter((group) => {
      return !userRelatedGroupIds.includes(getIdForRef(group.item).toString());
    }) || [];
  }

  /**
   * Check if user is granted access to page
   */
  isUserGrantedPageAccess(page: PageDocument, user, userRelatedGroups: PopulatedGrantedGroup[], allowAnyoneWithTheLink = false): boolean {
    if (page.grant === PageGrant.GRANT_PUBLIC) return true;
    if (page.grant === PageGrant.GRANT_RESTRICTED && allowAnyoneWithTheLink) return true;
    if (page.grant === PageGrant.GRANT_OWNER) return page.grantedUsers?.includes(user._id.toString()) ?? false;
    if (page.grant === PageGrant.GRANT_USER_GROUP) return this.getUserRelatedGrantedGroupsSyncronously(userRelatedGroups, page).length > 0;
    return false;
  }

  /**
   * see: https://dev.growi.org/635a314eac6bcd85cbf359fc
   * @param {string} targetPath
   * @param operator
   * @param {UpdateGrantInfo} updateGrantInfo
   * @returns {Promise<boolean>}
   */
  async canOverwriteDescendants(targetPath: string, operator: { _id: ObjectIdLike }, updateGrantInfo: UpdateGrantInfo): Promise<boolean> {
    const relatedGroupIds = [
      ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(operator)),
      ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(operator)),
    ];
    const operatorGrantInfo = {
      userId: operator._id,
      userGroupIds: new Set<ObjectIdLike>(relatedGroupIds),
    };

    const comparableDescendants = await this.generateComparableDescendants(targetPath, operator);

    const grantSet = new Set<PageGrant>();
    if (comparableDescendants.isPublicExist) {
      grantSet.add(PageGrant.GRANT_PUBLIC);
    }
    if (comparableDescendants.grantedUserIds.length > 0) {
      grantSet.add(PageGrant.GRANT_OWNER);
    }
    if (comparableDescendants.grantedGroupIds.length > 0) {
      grantSet.add(PageGrant.GRANT_USER_GROUP);
    }
    const descendantPagesGrantInfo = {
      grantSet,
      grantedUserIds: new Set(comparableDescendants.grantedUserIds), // all only me users of descendant pages
      grantedUserGroupIds: new Set(comparableDescendants.grantedGroupIds.map((g) => {
        return typeof g.item === 'string' ? g.item : g.item._id;
      })), // all user groups of descendant pages
    };

    return this.calcCanOverwriteDescendants(operatorGrantInfo, updateGrantInfo, descendantPagesGrantInfo);
  }

  async generateUpdateGrantInfoToOverwriteDescendants(
      operator, updateGrant?: PageGrant, grantGroupIds?: IGrantedGroup[],
  ): Promise<UpdateGrantInfo> {
    let updateGrantInfo: UpdateGrantInfo | null = null;

    if (updateGrant === PageGrant.GRANT_PUBLIC) {
      updateGrantInfo = {
        grant: PageGrant.GRANT_PUBLIC,
      };
    }
    else if (updateGrant === PageGrant.GRANT_OWNER) {
      updateGrantInfo = {
        grant: PageGrant.GRANT_OWNER,
        grantedUserId: operator._id,
      };
    }
    else if (updateGrant === PageGrant.GRANT_USER_GROUP) {
      if (grantGroupIds == null) {
        throw Error('The parameter `grantGroupIds` is required.');
      }
      const { grantedUserGroups: grantedUserGroupIds, grantedExternalUserGroups: grantedExternalUserGroupIds } = divideByType(grantGroupIds);

      const userGroupUserIds = await UserGroupRelation.findAllUserIdsForUserGroups(grantedUserGroupIds);
      const externalUserGroupUserIds = await ExternalUserGroupRelation.findAllUserIdsForUserGroups(grantedExternalUserGroupIds);
      const userIds = [...userGroupUserIds, ...externalUserGroupUserIds];

      const childrenOrItselfUserGroups = (await Promise.all(grantedUserGroupIds.map((groupId) => {
        return UserGroup.findGroupsWithDescendantsById(groupId);
      }))).flat();
      const childrenOrItselfExternalUserGroups = (await Promise.all(grantedExternalUserGroupIds.map((groupId) => {
        return ExternalUserGroup.findGroupsWithDescendantsById(groupId);
      }))).flat();
      const childrenOrItselfGroups = [...childrenOrItselfUserGroups, ...childrenOrItselfExternalUserGroups];
      const childrenOrItselfGroupIds = childrenOrItselfGroups.map(d => d._id);

      updateGrantInfo = {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedUserGroupInfo: {
          userIds: new Set<ObjectIdLike>(userIds),
          childrenOrItselfGroupIds: new Set<ObjectIdLike>(childrenOrItselfGroupIds),
        },
      };
    }

    if (updateGrantInfo == null) {
      // Neither pages with grant `GRANT_RESTRICTED` nor `GRANT_SPECIFIED` can be on a page tree.
      throw Error('The parameter `updateGrant` must be 1, 4, or 5');
    }

    return updateGrantInfo;
  }

  private calcIsAllDescendantsGrantedByOperator(operatorGrantInfo: OperatorGrantInfo, descendantPagesGrantInfo: DescendantPagesGrantInfo): boolean {
    if (descendantPagesGrantInfo.grantSet.has(PageGrant.GRANT_OWNER)) {
      const isNonApplicableOwnerExist = descendantPagesGrantInfo.grantedUserIds.size >= 2
        || !includesObjectIds([...descendantPagesGrantInfo.grantedUserIds], [operatorGrantInfo.userId]);
      if (isNonApplicableOwnerExist) {
        return false;
      }
    }

    if (descendantPagesGrantInfo.grantSet.has(PageGrant.GRANT_USER_GROUP)) {
      const isNonApplicableGroupExist = excludeTestIdsFromTargetIds(
        [...descendantPagesGrantInfo.grantedUserGroupIds], [...operatorGrantInfo.userGroupIds],
      ).length > 0;
      if (isNonApplicableGroupExist) {
        return false;
      }
    }

    return true;
  }

  private calcCanOverwriteDescendants(
      operatorGrantInfo: OperatorGrantInfo, updateGrantInfo: UpdateGrantInfo, descendantPagesGrantInfo: DescendantPagesGrantInfo,
  ): boolean {
    // 1. check is tree GRANTED and it returns true when GRANTED
    //   - GRANTED is the tree with all pages granted by the operator
    const isAllDescendantsGranted = this.calcIsAllDescendantsGrantedByOperator(operatorGrantInfo, descendantPagesGrantInfo);
    if (isAllDescendantsGranted) {
      return true;
    }

    // 2. if not 1. then,
    //   - when update grant is PUBLIC, return true
    if (updateGrantInfo.grant === PageGrant.GRANT_PUBLIC) {
      return true;
    }
    //   - when update grant is ONLYME, return false
    if (updateGrantInfo.grant === PageGrant.GRANT_OWNER) {
      return false;
    }
    //   - when update grant is USER_GROUP, return true if meets 2 conditions below
    //      a. if all descendants user groups are children or itself of update user group
    //      b. if all descendants grantedUsers belong to update user group
    if (updateGrantInfo.grant === PageGrant.GRANT_USER_GROUP) {
      const isAllDescendantGroupsChildrenOrItselfOfUpdateGroup = excludeTestIdsFromTargetIds(
        [...descendantPagesGrantInfo.grantedUserGroupIds], [...updateGrantInfo.grantedUserGroupInfo.childrenOrItselfGroupIds],
      ).length === 0; // a.
      const isUpdateGroupUsersIncludeAllDescendantsOwners = excludeTestIdsFromTargetIds(
        [...descendantPagesGrantInfo.grantedUserIds], [...updateGrantInfo.grantedUserGroupInfo.userIds],
      ).length === 0; // b.
      return isAllDescendantGroupsChildrenOrItselfOfUpdateGroup && isUpdateGroupUsersIncludeAllDescendantsOwners;
    }

    return false;
  }

}

export default PageGrantService;
