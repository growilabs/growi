import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

const ENDPOINT = '/_api/v3/change-proposal-settings';

/**
 * Turn the Change Proposal write feature on or off (admin only) and return the
 * previous value so the caller can restore it.
 */
export const setChangeProposalEnabled = async (
  adminRequest: APIRequestContext,
  isEnabled: boolean,
): Promise<boolean> => {
  const getRes = await adminRequest.get(ENDPOINT);
  expect(
    getRes.ok(),
    `get change-proposal-settings failed: ${getRes.status()} ${await getRes.text()}`,
  ).toBe(true);
  const { settings } = await getRes.json();

  const putRes = await adminRequest.put(ENDPOINT, { data: { isEnabled } });
  expect(
    putRes.ok(),
    `set change-proposal-settings failed: ${putRes.status()} ${await putRes.text()}`,
  ).toBe(true);
  return Boolean(settings.isEnabled);
};
