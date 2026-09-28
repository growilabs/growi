import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/api';

/**
 * E2E regression coverage for Task 6.3 (Requirement 3.3): a `$lsx` directive
 * with a `tag` option must still render the existing "disabled on the share
 * link page" message -- the `isSharedPage` gate in
 * packages/remark-lsx/src/client/components/Lsx.tsx is independent of the
 * `tag`/`prefix`/other options, and this test proves that end-to-end rather
 * than by re-reading the source.
 *
 * Uses a freshly created, isolated page (not the shared /Sandbox/Bootstrap5
 * fixture that access-to-sharelink.spec.ts exercises) so this test cannot
 * interfere with that other spec.
 */
test.describe
  .serial('$lsx tag option is still disabled on the share link page', () => {
    const stamp = `e2e-lsxtag-sharelink-${Date.now()}`;
    const tag = `lsx-e2e-tag-${stamp}`;
    const pagePath = `/Sandbox/${stamp}-lsx-disabled-with-tag`;

    const createdPages: CreatedPage[] = [];
    let createdSharelink: string | null;

    test.beforeAll(async ({ request }) => {
      createdPages.push(
        await createPage(request, {
          path: pagePath,
          body: `$lsx(${pagePath}, tag=${tag})`,
        }),
      );
    });

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, createdPages);
    });

    test('Prepare sharelink', async ({ page }) => {
      await page.goto(pagePath);

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

    test('the disabled message is shown even though the page has a tag-filtered $lsx', async ({
      browser,
    }) => {
      // Use a fresh, unauthenticated browser context rather than logging the
      // shared `page` fixture out of its admin session -- this project's
      // default `use.storageState` is set at the context level, so a brand
      // new context with no storageState is a guest viewer by construction.
      // This also sidesteps having to log the admin session back in afterward.
      const guestContext = await browser.newContext();
      const guestPage = await guestContext.newPage();

      try {
        // Access sharelink as a guest
        await guestPage.goto(`/share/${createdSharelink}`);
        await expect(guestPage.locator('.page-meta')).toBeVisible();

        // POSITIVE: the existing disabled-on-share-link message is rendered,
        // exactly as it would be for a $lsx directive with no `tag` option.
        await expect(
          guestPage.getByText('lsx is not available on the share link page'),
        ).toBeVisible();

        // NEGATIVE: the normal $lsx list UI (LsxSubstance) must NOT be
        // rendered -- LsxDisabled and LsxSubstance are mutually exclusive by
        // construction, but assert this directly so the test would fail if
        // that gate were ever bypassed for a tag-bearing directive.
        await expect(guestPage.locator('.lsx-load-more-row')).toHaveCount(0);
      } finally {
        await guestContext.close();
      }
    });
  });
