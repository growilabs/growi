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

    const imgCount = await page
      .locator('.user-list-content')
      .locator('img')
      .count();
    expect(imgCount).toBe(1);
  });
});
