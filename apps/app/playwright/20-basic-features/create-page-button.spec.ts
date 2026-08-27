import { expect, test } from '@playwright/test';

test.describe('Create page button', () => {
  test('click and autofocus to title text input', async ({ page }) => {
    await page.goto('/');

    // Click the container directly instead of scoping into a role-based
    // locator: `getByRole('button', { name: 'Create' })` substring-matches
    // both the create button (accessible name "Create edit") and the
    // dropend toggle (aria-label "Open create page menu"), which enters the
    // accessibility tree once hover state flips `aria-hidden` to false —
    // itself triggered by this click's own hover step — causing a strict
    // mode violation (see issue #11784). Same pattern already used in
    // access-to-page.spec.ts.
    await page.getByTestId('grw-page-create-button').click();

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
