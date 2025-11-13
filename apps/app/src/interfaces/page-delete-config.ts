export const PageDeleteConfigValue = {
  Anyone: 'anyOne', // must be "anyOne" (not "anyone") for backward compatibility
  AdminAndAuthor: 'adminAndAuthor',
  AdminOnly: 'adminOnly',
  Inherit: 'inherit',
} as const;
export type IPageDeleteConfigValue =
  (typeof PageDeleteConfigValue)[keyof typeof PageDeleteConfigValue];

export type IPageDeleteConfigValueToProcessValidation = Exclude<
  IPageDeleteConfigValue,
  typeof PageDeleteConfigValue.Inherit
>;

export const PageSingleDeleteConfigValue = {
  Anyone: 'anyOne', // must be "anyOne" (not "anyone") for backward compatibility
  AdminAndAuthor: 'adminAndAuthor',
  AdminOnly: 'adminOnly',
} as const;
export type PageSingleDeleteConfigValue = Exclude<
  IPageDeleteConfigValue,
  typeof PageDeleteConfigValue.Inherit
>;

export const PageSingleDeleteCompConfigValue = {
  Anyone: 'anyOne', // must be "anyOne" (not "anyone") for backward compatibility
  AdminAndAuthor: 'adminAndAuthor',
  AdminOnly: 'adminOnly',
} as const;
export type PageSingleDeleteCompConfigValue = Exclude<
  IPageDeleteConfigValue,
  typeof PageDeleteConfigValue.Inherit
>;

export const PageRecursiveDeleteConfigValue = {
  AdminAndAuthor: 'adminAndAuthor',
  AdminOnly: 'adminOnly',
  Inherit: 'inherit',
} as const;
export type PageRecursiveDeleteConfigValue = Exclude<
  IPageDeleteConfigValue,
  typeof PageDeleteConfigValue.Anyone
>;

export const PageRecursiveDeleteCompConfigValue = {
  AdminAndAuthor: 'adminAndAuthor',
  AdminOnly: 'adminOnly',
  Inherit: 'inherit',
} as const;
export type PageRecursiveDeleteCompConfigValue = Exclude<
  IPageDeleteConfigValue,
  typeof PageDeleteConfigValue.Anyone
>;
