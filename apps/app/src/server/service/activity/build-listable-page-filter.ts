import type { IUserHasId } from '@growi/core/dist/interfaces';
import { Types } from 'mongoose';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import { generateGrantCondition } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import {
  type RawPageFilter,
  toRawFilter,
} from '~/server/util/prisma-raw-normalize';

const STATUS_PUBLISHED = 'published';

// Same content as PageQueryBuilder.addConditionToExcludeTrashed.
const EXCLUDE_TRASHED = {
  $or: [{ status: null }, { status: STATUS_PUBLISHED }],
};

// Same content as PageQueryBuilder.addConditionToExcludeWipPage. That builder
// writes `{ wip: undefined }`, which the driver sends as null; here it has to
// be an explicit null, because an undefined value is dropped when the filter
// is serialized for findRaw and the emptied branch would match every page.
const EXCLUDE_WIP = {
  $or: [{ wip: null }, { wip: false }],
};

// Same content as the condition PageQueryBuilder adds unless includeEmpty is
// set.
const EXCLUDE_EMPTY = {
  $or: [{ isEmpty: false }, { isEmpty: null }],
};

/**
 * Builds the filter matching the pages the existing page lists show to the
 * viewer (trashed, WIP and empty pages excluded), in the form `findRaw` /
 * `aggregateRaw` accept.
 */
export const buildListablePageFilter = async (
  viewer: IUserHasId,
): Promise<RawPageFilter> => {
  const hideRestrictedByOwner = configManager.getConfig(
    'security:list-policy:hideRestrictedByOwner',
  );
  const hideRestrictedByGroup = configManager.getConfig(
    'security:list-policy:hideRestrictedByGroup',
  );

  const viewerGroupIds = [
    ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(viewer)),
    ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
      viewer,
    )),
  ];

  // toRawFilter converts ObjectId instances only, so ids that may arrive as
  // hex strings are turned into instances first.
  const grantCondition = generateGrantCondition(
    { _id: new Types.ObjectId(viewer._id) },
    viewerGroupIds.map((groupId) => new Types.ObjectId(groupId)),
    false,
    !hideRestrictedByOwner,
    !hideRestrictedByGroup,
  );

  return toRawFilter({
    $and: [grantCondition, EXCLUDE_TRASHED, EXCLUDE_WIP, EXCLUDE_EMPTY],
  });
};
