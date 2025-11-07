import { expect, test } from '@playwright/test';

test('Sub navigation sticky changes when scrolling down and up', async ({
  page,
}) => {
  await page.goto('/Sandbox');

  // Sticky
  await page.evaluate(() => window.scrollTo(0, 250));
  await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
    /active/,
  );

  // Not sticky
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.sticky-outer-wrapper').first()).not.toHaveClass(
    /active/,
  );
});
