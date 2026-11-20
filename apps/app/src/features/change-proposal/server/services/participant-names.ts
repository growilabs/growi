import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import UserGroup from '~/server/models/user-group';

import type { ReviewerKind, ReviewerRef } from '../../interfaces';
import { readRequesters } from './proposal-view-parts';
import type { GroupNameOf, UserSummaryOf } from './review-views';

type GroupKind = Exclude<ReviewerKind, 'user'>;
type NamedGroup = {
  readonly _id: { toString(): string };
  readonly name: string;
};

const GROUP_READERS: Record<
  GroupKind,
  (ids: readonly string[]) => Promise<readonly NamedGroup[]>
> = {
  'user-group': (ids) =>
    UserGroup.find({ _id: { $in: [...ids] } }, { name: 1 })
      .lean()
      .exec(),
  'external-user-group': (ids) =>
    ExternalUserGroup.find({ _id: { $in: [...ids] } }, { name: 1 })
      .lean()
      .exec(),
};

const readGroupNamesOf = async (
  kind: GroupKind,
  reviewers: readonly ReviewerRef[],
): Promise<ReadonlyMap<string, string>> => {
  const ids = [
    ...new Set(reviewers.filter((r) => r.kind === kind).map((r) => r.id)),
  ];
  const groups = ids.length === 0 ? [] : await GROUP_READERS[kind](ids);
  return new Map(groups.map((g) => [g._id.toString(), g.name]));
};

// At most one query per group kind; a deleted group reads as an empty name.
const readGroupNames = async (
  reviewers: readonly ReviewerRef[],
): Promise<GroupNameOf> => {
  const [userGroups, externalGroups] = await Promise.all([
    readGroupNamesOf('user-group', reviewers),
    readGroupNamesOf('external-user-group', reviewers),
  ]);
  const names: Record<GroupKind, ReadonlyMap<string, string>> = {
    'user-group': userGroups,
    'external-user-group': externalGroups,
  };
  return (kind, id) => names[kind].get(id) ?? '';
};

/**
 * The names a participant's view shows, in one user query and at most one per
 * group kind. Users are read as username and name only, never their email or
 * credentials.
 */
export const readParticipantNames = async (
  userIds: readonly string[],
  reviewers: readonly ReviewerRef[],
): Promise<{
  readonly userOf: UserSummaryOf;
  readonly groupNameOf: GroupNameOf;
}> => {
  const [userOf, groupNameOf] = await Promise.all([
    readRequesters(userIds),
    readGroupNames(reviewers),
  ]);
  return { userOf, groupNameOf };
};
