import { expect, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/AppendTextToEditorUntilContains';

/**
 * Regression test for the pre-load race in issue #11272.
 *
 * When the editor opens, the current page's grant is fetched asynchronously
 * (GET /_api/v3/page/grant-data) and synced into selectedGrantAtom. Until that
 * resolves, selectedGrant is null. Saving in that window must NOT send a grant,
 * so the update endpoint preserves the page's existing grant instead of
 * overwriting it with a default — otherwise a restricted (or inherited-restricted)
 * page would be silently published.
 *
 * Reproducing the "save immediately" case deterministically: hold the grant-data
 * response so the null window stays open, edit + save right away, and assert the
 * PUT /_api/v3/page body omits `grant`. If the fix regressed (a default grant is
 * sent again), grant-data would resolve to the page's grant and the PUT would
 * include it, failing this test.
 *
 * The loading indicator shown during this window is covered by the unit test in
 * GrantSelector.spec.tsx; here we assert the save-payload contract.
 */

const GRANT_DATA_ROUTE = '**/_api/v3/page/grant-data**';
const PAGE_UPDATE_ROUTE = '**/_api/v3/page';

test('omits grant on save while the page grant is still loading (#11272)', async ({
  page,
}) => {
  // Hold grant-data for the whole test so selectedGrant stays null (unresolved).
  await page.route(GRANT_DATA_ROUTE, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.continue();
  });

  // Capture the update payload and swallow the request so the DB is not mutated.
  let updateBody: Record<string, unknown> | undefined;
  await page.route(PAGE_UPDATE_ROUTE, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    const data = route.request().postData();
    updateBody = data != null ? JSON.parse(data) : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  await page.goto('/Sandbox');

  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  // Edit and save immediately, before grant-data resolves.
  await appendTextToEditorUntilContains(
    page,
    'pre-load race regression #11272',
  );
  await page.getByTestId('save-page-btn').click();

  // The update must be sent without a grant, so the server preserves the
  // page's existing grant rather than overwriting it.
  await expect.poll(() => updateBody).toBeDefined();
  expect(updateBody).not.toHaveProperty('grant');
  expect(updateBody).not.toHaveProperty('userRelatedGrantUserGroupIds');
});
