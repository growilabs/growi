import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Ensure a user group with the given name exists and return its id.
 *
 * Must be called with an admin-authenticated request context. Looks the group up
 * first (group names are unique) so re-runs reuse the existing group rather than
 * failing on a duplicate-name create.
 */
export const ensureUserGroup = async (
  adminRequest: APIRequestContext,
  name: string,
): Promise<string> => {
  const listRes = await adminRequest.get('/_api/v3/user-groups', {
    params: { pagination: 'false' },
  });
  expect(
    listRes.ok(),
    `list user-groups failed: ${listRes.status()} ${await listRes.text()}`,
  ).toBe(true);

  const { userGroups } = await listRes.json();
  const existing = (userGroups ?? []).find(
    (g: { name: string }) => g.name === name,
  );
  if (existing != null) {
    return existing._id;
  }

  const createRes = await adminRequest.post('/_api/v3/user-groups', {
    data: { name },
  });
  expect(
    createRes.ok(),
    `create user-group failed: ${createRes.status()} ${await createRes.text()}`,
  ).toBe(true);

  const { userGroup } = await createRes.json();
  return userGroup._id;
};

/**
 * Add a user (by username) to a user group. Must be called with an
 * admin-authenticated request context. The server deduplicates relations, so
 * this is safe to call repeatedly across re-runs.
 */
export const addUserToGroup = async (
  adminRequest: APIRequestContext,
  groupId: string,
  username: string,
): Promise<void> => {
  const res = await adminRequest.post(
    `/_api/v3/user-groups/${groupId}/users/${username}`,
  );
  expect(
    res.ok(),
    `addUserToGroup failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
};
