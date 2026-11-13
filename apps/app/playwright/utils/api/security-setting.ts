import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Read the current general security settings. Its shape mirrors the
 * `PUT /security-setting/general-setting` body, so it can be round-tripped back.
 */
const getGeneralSecuritySetting = async (
  adminRequest: APIRequestContext,
): Promise<Record<string, unknown>> => {
  const res = await adminRequest.get('/_api/v3/security-setting');
  expect(
    res.ok(),
    `get security-setting failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
  const { securityParams } = await res.json();
  return securityParams.generalSetting;
};

const putGeneralSecuritySetting = async (
  adminRequest: APIRequestContext,
  body: Record<string, unknown>,
  label: string,
): Promise<void> => {
  const res = await adminRequest.put(
    '/_api/v3/security-setting/general-setting',
    { data: body },
  );
  expect(
    res.ok(),
    `set ${label} failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
};

const PAGE_DELETION_AUTHORITY_KEYS = [
  'pageDeletionAuthority',
  'pageRecursiveDeletionAuthority',
  'pageCompleteDeletionAuthority',
  'pageRecursiveCompleteDeletionAuthority',
] as const;

type PageDeletionAuthorityKey = (typeof PAGE_DELETION_AUTHORITY_KEYS)[number];

/** The authorities a call changed, holding the values to put back. */
export type PageDeletionAuthorities = Partial<
  Record<PageDeletionAuthorityKey, unknown>
>;

// What the server reads an unset authority as: 'anyOne' for the single ones,
// 'inherit' for the recursive ones (prepareDeleteConfigValuesForCalc).
const ANYONE_MAY_DELETE: Record<PageDeletionAuthorityKey, string> = {
  pageDeletionAuthority: 'anyOne',
  pageRecursiveDeletionAuthority: 'inherit',
  pageCompleteDeletionAuthority: 'anyOne',
  pageRecursiveCompleteDeletionAuthority: 'inherit',
};

const writeGeneralSecuritySetting = async (
  adminRequest: APIRequestContext,
  current: Record<string, unknown>,
  values: PageDeletionAuthorities,
): Promise<void> => {
  if (Object.keys(values).length === 0) return;
  await putGeneralSecuritySetting(
    adminRequest,
    { ...current, ...values },
    'page deletion authorities',
  );
};

/**
 * Let any user move pages to the trash and delete them completely (admin only),
 * returning what was changed so restorePageDeletionAuthorities can put it back.
 * Only authorities that are set to something else are written: an unset one
 * already means the same, and writing it could not be undone through the API
 * (the stored value is not equivalent to unset everywhere, e.g. for multi-group
 * pages). Round-trips the whole body for the same reason as
 * setHideRestrictedByGroup.
 */
export const allowAnyoneToDeletePages = async (
  adminRequest: APIRequestContext,
): Promise<PageDeletionAuthorities> => {
  const current = await getGeneralSecuritySetting(adminRequest);
  const changedKeys = PAGE_DELETION_AUTHORITY_KEYS.filter(
    (key) => current[key] != null && current[key] !== ANYONE_MAY_DELETE[key],
  );
  await writeGeneralSecuritySetting(
    adminRequest,
    current,
    Object.fromEntries(changedKeys.map((key) => [key, ANYONE_MAY_DELETE[key]])),
  );
  return Object.fromEntries(changedKeys.map((key) => [key, current[key]]));
};

/** Puts back the authorities allowAnyoneToDeletePages changed. */
export const restorePageDeletionAuthorities = async (
  adminRequest: APIRequestContext,
  previous: PageDeletionAuthorities,
): Promise<void> => {
  if (Object.keys(previous).length === 0) return;
  const current = await getGeneralSecuritySetting(adminRequest);
  await writeGeneralSecuritySetting(adminRequest, current, previous);
};

/**
 * Set `hideRestrictedByGroup` (admin only) and return its previous value so the
 * caller can restore it. Round-trips the WHOLE body because the PUT handler
 * rebuilds every config key from `req.body`, so an omitted field would be
 * clobbered (e.g. sessionMaxAge → null).
 */
export const setHideRestrictedByGroup = async (
  adminRequest: APIRequestContext,
  value: boolean,
): Promise<boolean> => {
  const current = await getGeneralSecuritySetting(adminRequest);
  await putGeneralSecuritySetting(
    adminRequest,
    { ...current, hideRestrictedByGroup: value },
    'hideRestrictedByGroup',
  );
  return Boolean(current.hideRestrictedByGroup);
};
