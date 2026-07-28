export type IUserGroupMember = {
  username: string;
  name: string;
};

// key: group _id (string) → members
export type RelatedGroupsMembers = Record<string, IUserGroupMember[]>;

export type IResRelatedGroupsMembers = {
  membersByGroupId: RelatedGroupsMembers;
};
