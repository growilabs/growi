export const UserStatus = {
  STATUS_REGISTERED: 1,
  STATUS_ACTIVE: 2,
  STATUS_SUSPENDED: 3,
  STATUS_DELETED: 4,
  STATUS_INVITED: 5,
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// The single definition of "inactive": every status other than ACTIVE,
// including DELETED. Audit logs need to keep surfacing deleted users as a
// filterable username, so this set intentionally does not exclude them.
export const INACTIVE_USER_STATUSES: readonly UserStatus[] = [
  UserStatus.STATUS_REGISTERED,
  UserStatus.STATUS_SUSPENDED,
  UserStatus.STATUS_DELETED,
  UserStatus.STATUS_INVITED,
];

export const USER_FIELDS_EXCEPT_CONFIDENTIAL =
  '_id image isEmailPublished isGravatarEnabled googleId name username email introduction' +
  ' status lang createdAt lastLoginAt admin imageUrlCached';
