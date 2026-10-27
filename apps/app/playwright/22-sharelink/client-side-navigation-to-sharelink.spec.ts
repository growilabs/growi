import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/api';

const createShareLink = async (
  request: APIRequestContext,
  pageId: string,
): Promise<string> => {
  const res = await request.post('/_api/v3/share-links', {
    data: { relatedPage: pageId },
  });
  expect(
    res.ok(),
    `share link creation failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
  const shareLink = await res.json();
  return shareLink.id ?? shareLink._id;
};

// A full page load discards window state, so a surviving marker proves the
// navigation was handled client-side by the Next.js router.
const markWindow = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as Window & { __e2eNoReload?: boolean }).__e2eNoReload = true;
  });
const isWindowMarked = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      (window as Window & { __e2eNoReload?: boolean }).__e2eNoReload === true,
  );

test.describe
  .serial('Client-side navigation to a share link page', () => {
    const stamp = `e2e-sharelink-csr-${Date.now()}`;
    const sourceSentence = `${stamp} regular source page`;
    const firstSharedSentence = `${stamp} first shared page`;
    const secondSharedSentence = `${stamp} second shared page`;

    const createdPages: CreatedPage[] = [];
    let sourcePath: string;
    let firstShareLinkId: string;
    let secondShareLinkId: string;

    test.beforeAll(async ({ request }) => {
      const secondShared = await createPage(request, {
        path: `/Sandbox/${stamp}/second-shared`,
        body: secondSharedSentence,
      });
      createdPages.push(secondShared);
      secondShareLinkId = await createShareLink(request, secondShared.pageId);

      const firstShared = await createPage(request, {
        path: `/Sandbox/${stamp}/first-shared`,
        body: `${firstSharedSentence}\n\n[to second share](/share/${secondShareLinkId})`,
      });
      createdPages.push(firstShared);
      firstShareLinkId = await createShareLink(request, firstShared.pageId);

      const source = await createPage(request, {
        path: `/Sandbox/${stamp}/source`,
        body: `${sourceSentence}\n\n[to first share](/share/${firstShareLinkId})`,
      });
      createdPages.push(source);
      sourcePath = source.path;
    });

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, createdPages);
    });

    test('from a regular page, the shared page is displayed', async ({
      page,
    }) => {
      await page.goto(sourcePath);
      await expect(page.locator('.wiki').first()).toContainText(sourceSentence);
      await markWindow(page);

      await page.getByRole('link', { name: 'to first share' }).click();

      await expect(page).toHaveURL(`/share/${firstShareLinkId}`);
      await expect(page.locator('.wiki').first()).toContainText(
        firstSharedSentence,
      );
      await expect(page.locator('.page-meta')).toBeVisible();
      expect(await isWindowMarked(page)).toBe(true);
    });

    test('from a share link page, another shared page is displayed', async ({
      page,
    }) => {
      await page.goto(`/share/${firstShareLinkId}`);
      await expect(page.locator('.wiki').first()).toContainText(
        firstSharedSentence,
      );
      await markWindow(page);

      await page.getByRole('link', { name: 'to second share' }).click();

      await expect(page).toHaveURL(`/share/${secondShareLinkId}`);
      await expect(page.locator('.wiki').first()).toContainText(
        secondSharedSentence,
      );
      await expect(page.locator('.page-meta')).toBeVisible();
      expect(await isWindowMarked(page)).toBe(true);
    });
  });
