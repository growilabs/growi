import { expect, test } from '@playwright/test';

test.describe('Sticky features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // react-stickynode measures the wrapper's initial offset at mount time.
    // Scrolling immediately after goto() races that measurement against
    // client-side hydration and any post-load data fetches that affect
    // layout (e.g. sidebar width), which intermittently leaves the very
    // first scroll event checked against a stale/not-yet-computed trigger
    // point. Waiting for the network to settle and the wrapper to actually
    // be visible before scrolling lets that initial measurement complete
    // first. See growilabs/growi#11780, #11797, #11798 (and sibling issues
    // in this file) for the flaky occurrences this addresses.
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sticky-outer-wrapper').first()).toBeVisible();
  });

  test('Subnavigation displays changes on scroll down and up', async ({
    page,
  }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.sticky-outer-wrapper').first()).not.toHaveClass(
      /active/,
    );
  });

  test('Subnavigation is not displayed when move to other pages', async ({
    page,
  }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Move to /Sandbox page
    await page.goto('/Sandbox');
    await expect(page.locator('.sticky-outer-wrapper').first()).not.toHaveClass(
      /active/,
    );
  });

  test('Able to click buttons on subnavigation switcher when sticky', async ({
    page,
  }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Click editor button
    await page.getByTestId('editor-button').click();
    await expect(page.locator('.layout-root')).toHaveClass(/editing/);
  });

  test('Subnavigation is sticky when on small window', async ({ page }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Set viewport to small size
    await page.setViewportSize({ width: 600, height: 1024 });
    await expect(
      page
        .getByTestId('grw-contextual-sub-nav')
        .getByTestId('grw-page-editor-mode-manager'),
    ).toBeVisible();
  });
});
