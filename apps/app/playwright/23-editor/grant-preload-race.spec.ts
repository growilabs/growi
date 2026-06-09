import { expect, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/AppendTextToEditorUntilContains';

/**
 * Regression test for the pre-load race in issue #11272.
 *
 * When the editor opens, the current page's grant is fetched asynchronously
 * (GET /_api/v3/page/grant-data) and synced into selectedGrantAtom. Until that
 * resolves, selectedGrant is null. Saving in that window must NOT change the
 * page's grant — otherwise a restricted page is silently published.
 *
 * This drives the real cross-stack behavior:
 *   1. create a GRANT_OWNER ("only me") page,
 *   2. hold the grant-data response so the editor opens with selectedGrant still null,
 *   3. edit and save immediately (a real save to the DB),
 *   4. read the page's grant back and assert it is still GRANT_OWNER.
 *
 * page.request (APIRequestContext) is not subject to page.route, so the setup and
 * verification calls bypass the hold that only affects the browser's fetch.
 */

const GRANT_DATA_ROUTE = '**/_api/v3/page/grant-data**';
const GRANT_OWNER = 4; // PageGrant.GRANT_OWNER

const readGrant = async (
  request: import('@playwright/test').APIRequestContext,
  pageId: string,
): Promise<number> => {
  const res = await request.get('/_api/v3/page/grant-data', {
    params: { pageId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).grantData.currentPageGrant.grant;
};

test('keeps an owner-only grant when saving before the grant loads (#11272)', async ({
  page,
}) => {
  const pagePath = `/grant-preload-race-${Date.now()}`;

  // 1. Create an "only me" (GRANT_OWNER) page.
  const createRes = await page.request.post('/_api/v3/page', {
    data: { path: pagePath, body: 'initial body', grant: GRANT_OWNER },
  });
  expect(createRes.ok()).toBeTruthy();
  const createdPageId: string = (await createRes.json()).page._id;
  expect(await readGrant(page.request, createdPageId)).toBe(GRANT_OWNER);

  // 2. Block the browser's grant-data fetch so the editor opens with
  //    selectedGrant still unresolved (null) — the pre-load window. Aborting is a
  //    deterministic stand-in for "not loaded yet". page.request (used below for
  //    verification) is an APIRequestContext and is NOT affected by page.route.
  await page.route(GRANT_DATA_ROUTE, async (route) => {
    if (route.request().method() === 'GET') {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto(pagePath);
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  // 3. Edit and save immediately, while selectedGrant is still null.
  await appendTextToEditorUntilContains(page, 'edited before grant loaded');
  const updateResponse = page.waitForResponse(
    (res) =>
      res.url().includes('/_api/v3/page') && res.request().method() === 'PUT',
  );
  await page.getByTestId('save-page-btn').click();
  expect((await updateResponse).ok()).toBeTruthy();

  // 4. The stored grant must still be owner-only (not published).
  expect(await readGrant(page.request, createdPageId)).toBe(GRANT_OWNER);
});
