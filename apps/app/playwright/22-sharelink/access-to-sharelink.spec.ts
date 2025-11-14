import { expect, test } from '@playwright/test';

import { login } from '../utils/Login';

test.describe
  .serial('Access to sharelink by guest', () => {
    let createdSharelink: string | null;

    test('Prepare sharelink', async ({ page }) => {
      await page.goto('/Sandbox/Bootstrap5');

      // Create Sharelink
      await page.getByTestId('open-page-item-control-btn').click();
      await page
        .getByTestId(
          'open-page-accessories-modal-btn-with-share-link-management-data-tab',
        )
        .click();
      await page.getByTestId('btn-sharelink-toggleform').click();
      await page.getByTestId('btn-sharelink-issue').click();

      // Get ShareLink
      createdSharelink = await page.getByTestId('share-link').textContent();
      expect(createdSharelink).toHaveLength(24);
    });

    test('The sharelink page is successfully loaded', async ({ page }) => {
      await page.goto('/');

      // Logout
      await page.getByTestId('personal-dropdown-button').click();
      await expect(page.getByTestId('logout-button')).toBeVisible();
      await page.getByTestId('logout-button').click();
      await page.waitForURL('http://localhost:3000/login');

      // Access sharelink
      await page.goto(`/share/${createdSharelink}`);
      await expect(page.locator('.page-meta')).toBeVisible();

      await login(page);
    });
  });
