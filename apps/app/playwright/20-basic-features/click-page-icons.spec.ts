import { expect, test } from '@playwright/test';

test.describe('Click page icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/Sandbox');
  });

  test('Successfully Subscribe/Unsubscribe a page', async ({ page }) => {
    const subscribeButton = page.locator('.btn-subscribe');

    // Subscribe
    await subscribeButton.click();
    await expect(subscribeButton).toHaveClass(/active/);

    // Unsubscribe
    await subscribeButton.click();
    await expect(subscribeButton).not.toHaveClass(/active/);
  });

  test('Successfully Like/Unlike a page', async ({ page }) => {
    const likeButton = page.locator('.btn-like').first();

    // Like
    await likeButton.click();
    await expect(likeButton).toHaveClass(/active/);

    // Unlike
    await likeButton.click();
    await expect(likeButton).not.toHaveClass(/active/);
  });

  test('Successfully Bookmark / Unbookmark a page', async ({ page }) => {
    const bookmarkButton = page.locator('.btn-bookmark').first();

    // Bookmark
    await bookmarkButton.click();
    await expect(bookmarkButton).toHaveClass(/active/);

    // Unbookmark
    await page.locator('.grw-bookmark-folder-menu-item').click();
    await expect(bookmarkButton).not.toHaveClass(/active/);
  });

  test('Successfully display list of "seen by user"', async ({ page }) => {
    await page.locator('.btn-seen-user').click();

    // The popover content (.user-list-content and its imgs) mounts
    // asynchronously after the click. Use a web-first assertion that
    // auto-retries until the count matches, instead of a one-shot .count()
    // that races the popover mount and reads 0.
    await expect(page.locator('.user-list-content').locator('img')).toHaveCount(
      1,
    );
  });
});
