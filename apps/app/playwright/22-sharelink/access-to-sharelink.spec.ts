import { expect, test } from '@playwright/test';

test.describe
  .serial('Access to sharelink by guest', () => {
    let createdSharelink: string | null;

    test('Prepare sharelink', async ({ page }) => {
      await page.goto('/Sandbox/Bootstrap5');

      // Create Sharelink
      await page
        .getByTestId('grw-contextual-sub-nav')
        .getByTestId('open-page-item-control-btn')
        .click();
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

    test('The sharelink page is successfully loaded', async ({ browser }) => {
      // A fresh context without storageState is a guest viewer. Logging the
      // shared admin session out instead would invalidate it for every other
      // worker that reuses the same admin cookie.
      const guestContext = await browser.newContext();
      const guestPage = await guestContext.newPage();

      try {
        // Access sharelink
        await guestPage.goto(`/share/${createdSharelink}`);
        await expect(guestPage.locator('.page-meta')).toBeVisible();

        // Comments are shown read-only on the share link page:
        // - the comments area is rendered
        // - no comment posting form is offered to the guest (read-only)
        // - with no comments, an empty-state message is shown (not a bare heading)
        await expect(guestPage.locator('.page-comments-row')).toBeVisible();
        await expect(guestPage.locator('#page-comment-write')).toHaveCount(0);
        await expect(
          guestPage.getByTestId('comments-empty-state'),
        ).toBeVisible();
      } finally {
        await guestContext.close();
      }
    });
  });
