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
    const toggle = page
      .getByTestId('grw-page-create-button')
      .getByLabel('Open create page menu');
    await expect(toggle).toBeVisible();
    // `dispatchEvent` (not `.click()`) is required here: the toggle's
    // clickable area overlaps the sibling create-button's SVG (Hexagon)
    // shape, so a real click's hit-test resolves to that SVG's `<path>`
    // instead of the toggle and fails deterministically (verified locally —
    // switching this to `.click()` fails 10/10 with "subtree intercepts
    // pointer events"). `dispatchEvent` bypasses hit-testing and dispatches
    // straight to the toggle, which is safe here since it is a real,
    // synchronous state change (dropdown opens immediately on click).
    await toggle.dispatchEvent('click');
    const menuItem = page.getByRole('menuitem', { name: 'Create today page' });
    // Wait for the menu item to be visible *before* clicking it, as a
    // separate step: reactstrap's Dropdown mounts/positions its menu (a
    // `container="body"` portal) asynchronously after the toggle event, and
    // queuing `.click()` immediately can catch a node that is still
    // being replaced mid-mount — the "element was detached from the DOM,
    // retrying" signature seen in growilabs/growi#11779. Resolving the
    // locator fresh via `.click()`'s own actionability wait, only after
    // this settles, avoids racing that mount.
    await expect(menuItem).toBeVisible();
    await menuItem.click();

    // should not be visible
    await expect(page.getByPlaceholder('Input page name')).not.toBeVisible();
  });
});
