import { expect, test as setup } from '@playwright/test';

import { login } from './utils/Login';

// Commonised login process for use elsewhere
// see: https://github.com/microsoft/playwright/issues/22114
setup('Authenticate as the "admin" user', async ({ page }) => {
  await login(page);

  // login() only verifies the form submission left /login. Confirm the persisted
  // session actually has admin privileges by reaching the admin dashboard —
  // otherwise a non-admin login would silently pass.
  await page.goto('/admin');
  await expect(page).toHaveTitle(/Wiki Management Homepage/);
});
