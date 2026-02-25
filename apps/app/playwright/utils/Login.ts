import path from 'node:path';
import { expect, type Page } from '@playwright/test';

const authFile = path.resolve(__dirname, '../.auth/admin.json');

export const login = async (page: Page): Promise<void> => {
  // Perform authentication steps. Replace these actions with your own.
  await page.goto('/admin');

  const loginForm = await page.getByTestId('login-form');

  if (loginForm != null) {
    await loginForm.getByPlaceholder('Username or E-mail').fill('admin');
    await loginForm.getByPlaceholder('Password').fill('adminadmin');
    await loginForm
      .locator('[type=submit]')
      .filter({ hasText: 'Login' })
      .click();
  }

  await page.waitForURL('/admin');
  await expect(page).toHaveTitle(/Wiki Management Homepage/);

  // End of authentication steps.
  await page.context().storageState({ path: authFile });
};
