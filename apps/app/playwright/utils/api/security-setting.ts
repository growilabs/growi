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
  const res = await adminRequest.put(
    '/_api/v3/security-setting/general-setting',
    { data: { ...current, hideRestrictedByGroup: value } },
  );
  expect(
    res.ok(),
    `set hideRestrictedByGroup failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
  return Boolean(current.hideRestrictedByGroup);
};
