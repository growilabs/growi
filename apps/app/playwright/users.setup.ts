import type { APIRequestContext, Browser } from '@playwright/test';
import { test as setup } from '@playwright/test';

import { activateInvitedUser, inviteUser } from './utils/api';
import { fillLoginForm, login } from './utils/login';
import { FILTER_TEST_USERS, type TestUser } from './utils/test-users';

const provisionUser = async (
  browser: Browser,
  adminRequest: APIRequestContext,
  user: TestUser,
): Promise<void> => {
  const temporaryPassword = await inviteUser(adminRequest, user.email);

  // Newly invited -> log in with the temporary password (which leaves the
  // session in "invited" status) and complete registration.
  if (temporaryPassword != null) {
    const context = await browser.newContext();
    try {
      const invitedPage = await context.newPage();
      await fillLoginForm(invitedPage, user.email, temporaryPassword);
      await activateInvitedUser(context.request, user);
    } finally {
      await context.close();
    }
  }

  // Persist a clean authenticated session for this user.
  const context = await browser.newContext();
  try {
    const userPage = await context.newPage();
    await login(userPage, {
      usernameOrEmail: user.username,
      password: user.password,
      authFile: user.authFile,
    });
  } finally {
    await context.close();
  }
};

/**
 * Provision the users needed by the author/editor search-filter tests and save a
 * storageState file for each, so specs can act as them via
 * `browser.newContext({ storageState })`.
 *
 * Runs in the dedicated `users` project, which every browser test project
 * depends on, so the auth files exist before the specs run. It must NOT live in
 * the generic `setup` project: that one is a dependency of the installer project
 * and runs against a fresh, uninstalled DB, where the admin login this performs
 * would time out.
 * Idempotent: re-runs reuse existing accounts and just refresh their auth files.
 */
setup('provision filter test users', async ({ page, browser }) => {
  // Authenticate as admin to be able to invite.
  await fillLoginForm(page, 'admin', 'adminadmin');
  const adminRequest = page.request;

  // Each user is provisioned independently.
  await Promise.all(
    FILTER_TEST_USERS.map((user) => provisionUser(browser, adminRequest, user)),
  );
});
