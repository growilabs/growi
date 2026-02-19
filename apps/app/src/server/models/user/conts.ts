export const UserStatus = {
  STATUS_REGISTERED: 1,
  STATUS_ACTIVE: 2,
  STATUS_SUSPENDED: 3,
  STATUS_DELETED: 4,
  STATUS_INVITED: 5,
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const USER_FIELDS_EXCEPT_CONFIDENTIAL =
  '_id image isEmailPublished isGravatarEnabled googleId name username email introduction' +
  ' status lang createdAt lastLoginAt admin imageUrlCached';
