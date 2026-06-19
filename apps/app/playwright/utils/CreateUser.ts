import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

import type { TestUser } from './test-users';

/**
 * Invite a user by e-mail via the admin-only endpoint (POST /_api/v3/users/invite).
 *
 * Must be called with an admin-authenticated request context. Returns the
 * generated temporary password for the new account, or `null` when a user with
 * that e-mail already exists — so callers can treat provisioning as idempotent
 * across re-runs (the e2e database is persistent).
 */
export const inviteUser = async (
  adminRequest: APIRequestContext,
  email: string,
): Promise<string | null> => {
  const res = await adminRequest.post('/_api/v3/users/invite', {
    data: { shapedEmailList: [email], sendEmail: false },
  });
  expect(
    res.ok(),
    `inviteUser failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);

  const json = await res.json();
  const created = (json.createdUserList ?? []).find(
    (u: { email: string }) => u.email === email,
  );
  // Absent from createdUserList -> already existed (see existingEmailList).
  return created?.password ?? null;
};

/**
 * Complete an invited user's registration (POST /_api/v3/invited), setting their
 * permanent username, name and password.
 *
 * Must be called with a request context already authenticated as the invited
 * user (logged in with the temporary password) — the endpoint activates
 * `req.user`.
 */
export const activateInvitedUser = async (
  invitedUserRequest: APIRequestContext,
  user: TestUser,
): Promise<void> => {
  const res = await invitedUserRequest.post('/_api/v3/invited', {
    data: {
      invitedForm: {
        username: user.username,
        name: user.name,
        password: user.password,
      },
    },
  });
  expect(
    res.ok(),
    `activateInvitedUser failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
};
