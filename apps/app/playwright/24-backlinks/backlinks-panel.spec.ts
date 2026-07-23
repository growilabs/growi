import { expect, type Page, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/api';

// B1.16 — E2E for the backlinks panel (Story B1 slice), covering Req 1.1 / 1.7 / 1.8.

// Fixed stamp so afterAll teardown keeps re-runs idempotent against the persistent e2e DB.
const stamp = 'e2e-backlinks-7a2f1c';
const targetPath = `/Sandbox/${stamp}-target`;
const sourcePath = `/Sandbox/${stamp}-source`;
const emptyPath = `/Sandbox/${stamp}-empty`;

// Backlinks tab = page-item-control dropdown -> Backlinks entry -> PageAccessoriesModal.
const openBacklinksPanel = async (page: Page): Promise<void> => {
  const nav = page.getByTestId('grw-contextual-sub-nav');
  await expect(nav).toBeVisible();

  const controlButton = nav.getByTestId('open-page-item-control-btn');
  await expect(controlButton).toBeVisible();
  await expect(controlButton).toBeEnabled();
  await controlButton.click();

  const tabButton = page.getByTestId(
    'open-page-accessories-modal-btn-with-backlinks-tab',
  );
  await expect(tabButton).toBeVisible();
  await tabButton.click();
};

test.describe
  .serial('Backlinks panel', () => {
    const created: CreatedPage[] = [];

    test.beforeAll(async ({ request }) => {
      // Create the target before the source: the B1 handler resolves links at
      // extraction time and does not re-resolve inbound matches (that is B4), so a
      // link to a not-yet-existing target resolves to null and never becomes a backlink.
      created.push(
        await createPage(request, {
          path: targetPath,
          body: `backlinks target ${stamp}`,
        }),
      );
      created.push(
        await createPage(request, {
          path: sourcePath,
          body: `link to [target](${targetPath})`,
        }),
      );
      created.push(
        await createPage(request, {
          path: emptyPath,
          body: `no incoming links ${stamp}`,
        }),
      );
    });

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, created);
    });

    test('lists a linking page with its title and path', async ({ page }) => {
      const list = page.getByTestId('backlinks-list');
      // Match on accessible name (the row's visible text) — proving the title shows
      // (Req 1.8) — not on the permalink href, an internal detail of the row.
      const sourceRow = list.getByRole('link', {
        name: new RegExp(`${stamp}-source`),
      });

      await expect(async () => {
        // Rows are written asynchronously by the event-driven PageLinkService, so
        // reload each attempt to re-trigger the SWR fetch until extraction catches up.
        await page.goto(targetPath);
        await openBacklinksPanel(page);

        await expect(list).toBeVisible({ timeout: 3000 });
        await expect(sourceRow).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // Other half of Req 1.8: the former path shows alongside the title.
      await expect(sourceRow).toContainText('Sandbox');
    });

    test('shows the empty state when a page has no backlinks', async ({
      page,
    }) => {
      await page.goto(emptyPath);
      await openBacklinksPanel(page);

      // `backlinks-empty` renders only after a successful zero-row fetch (loading has
      // its own test-id), so this asserts a real "no backlinks", not a masked load state.
      await expect(page.getByTestId('backlinks-empty')).toBeVisible();
      await expect(page.getByTestId('backlinks-list')).toHaveCount(0);
    });
  });
