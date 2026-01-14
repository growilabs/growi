import { test as setup } from '@playwright/test';

import { login } from './utils/Login';

// Commonised login process for use elsewhere
// see: https://github.com/microsoft/playwright/issues/22114
setup('Authenticate as the "admin" user', async ({ page }) => {
  await login(page);
});
