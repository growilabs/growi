import { expect, test } from '@playwright/test';

test('Sub navigation sticky changes when scrolling down and up', async ({
  page,
}) => {
  await page.goto('/Sandbox');

  // Wait until the page is scrollable
  await expect
    .poll(async () => {
      const { scrollHeight, innerHeight } = await page.evaluate(() => ({
        scrollHeight: document.body.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      return scrollHeight > innerHeight + 250;
    })
    .toBe(true);

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
