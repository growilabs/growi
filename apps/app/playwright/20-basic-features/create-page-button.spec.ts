import { expect, test } from '@playwright/test';

test.describe('Create page button', () => {
  test('click and autofocus to title text input', async ({ page }) => {
    await page.goto('/');

    await page
      .getByTestId('grw-page-create-button')
      .getByRole('button', { name: 'Create' })
      .click();

    // should be focused
    await expect(page.getByPlaceholder('Input page name')).toBeFocused();
  });
});

test.describe('Create page button dropdown menu', () => {
  test('open and create today page', async ({ page }) => {
    await page.goto('/');

    // open dropdown menu
    await page.getByTestId('grw-page-create-button').hover();
    await expect(
      page
        .getByTestId('grw-page-create-button')
        .getByLabel('Open create page menu'),
    ).toBeVisible();
    await page
      .getByTestId('grw-page-create-button')
      .getByLabel('Open create page menu')
      .dispatchEvent('click'); // simulate the click
    await page.getByRole('menuitem', { name: 'Create today page' }).click();

    // should not be visible
    await expect(page.getByPlaceholder('Input page name')).not.toBeVisible();
  });
});
