import path from 'node:path';
import { expect, type Page } from '@playwright/test';

const authFile = path.resolve(__dirname, '../.auth/admin.json');

export const login = async (page: Page): Promise<void> => {
  // Perform authentication steps. Replace these actions with your own.
  await page.goto('/admin');

  const loginForm = await page.getByRole('form');

  if (loginForm != null) {
    await page.getByLabel('Username or E-mail').fill('admin');
    await page.getByLabel('Password').fill('adminadmin');
    await page.locator('[type=submit]').filter({ hasText: 'Login' }).click();
  }

  await page.waitForURL('/admin');
  await expect(page).toHaveTitle(/Wiki Management Homepage/);

  // End of authentication steps.
  await page.context().storageState({ path: authFile });
};
