import { expect, test } from '@playwright/test';

test('Sub navigation sticky changes when scrolling down and up', async ({
  page,
}) => {
  await page.goto('/Sandbox');

  // react-stickynode measures the wrapper's initial offset at mount time.
  // Scrolling immediately after goto() races that measurement against
  // client-side hydration and any post-load data fetches that affect
  // layout, which intermittently leaves the very first scroll event
  // checked against a stale/not-yet-computed trigger point. Waiting for
  // the network to settle and the wrapper to actually be visible before
  // scrolling lets that initial measurement complete first. Same
  // mechanism as growilabs/growi#11780/#11797/#11798 in the sibling
  // sticky-features.spec.ts (see PR #11801) — this spec has its own
  // instance of the same race. See growilabs/growi#11782.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.sticky-outer-wrapper').first()).toBeVisible();

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
