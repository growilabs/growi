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
  expiredAt?: Date,
): Promise<string> => {
  const res = await request.post('/_api/v3/share-links', {
    data: { relatedPage: pageId, expiredAt: expiredAt?.toISOString() },
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

const pageTitle = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });

test.describe
  .serial('Client-side navigation to a share link page', () => {
    const stamp = `e2e-sharelink-csr-${Date.now()}`;
    const sourceSentence = `${stamp} regular source page`;
    const firstSharedSentence = `${stamp} first shared page`;
    const secondSharedSentence = `${stamp} second shared page`;
    const expiredSharedSentence = `${stamp} expired shared page`;
    // well-formed but never issued
    const missingShareLinkId = '0123456789abcdef01234567';

    const createdPages: CreatedPage[] = [];
    let sourcePath: string;
    let firstShareLinkId: string;
    let secondShareLinkId: string;
    let expiredShareLinkId: string;
    let shareLinkExpiredAt: Date;

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

      const expiredShared = await createPage(request, {
        path: `/Sandbox/${stamp}/expired-shared`,
        body: expiredSharedSentence,
      });
      createdPages.push(expiredShared);
      // A past date is rejected on creation, so issue a link that expires soon.
      shareLinkExpiredAt = new Date(Date.now() + 3000);
      expiredShareLinkId = await createShareLink(
        request,
        expiredShared.pageId,
        shareLinkExpiredAt,
      );

      const source = await createPage(request, {
        path: `/Sandbox/${stamp}/source`,
        body: [
          sourceSentence,
          `[to first share](/share/${firstShareLinkId})`,
          `[to missing share](/share/${missingShareLinkId})`,
          `[to expired share](/share/${expiredShareLinkId})`,
        ].join('\n\n'),
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

    test('from a share link page, another shared page is displayed to a guest', async ({
      browser,
    }) => {
      const guestContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      try {
        const guestPage = await guestContext.newPage();
        await guestPage.goto(`/share/${firstShareLinkId}`);
        await expect(guestPage.locator('.wiki').first()).toContainText(
          firstSharedSentence,
        );
        await markWindow(guestPage);

        await guestPage.getByRole('link', { name: 'to second share' }).click();

        await expect(guestPage).toHaveURL(`/share/${secondShareLinkId}`);
        await expect(guestPage.locator('.wiki').first()).toContainText(
          secondSharedSentence,
        );
        await expect(guestPage.locator('.page-meta')).toBeVisible();
        expect(await isWindowMarked(guestPage)).toBe(true);
      } finally {
        await guestContext.close();
      }
    });

    test('from a regular page, a missing share link shows not found without the previous page', async ({
      page,
    }) => {
      await page.goto(sourcePath);
      await expect(pageTitle(page, 'source')).toBeVisible();
      await markWindow(page);

      await page.getByRole('link', { name: 'to missing share' }).click();

      await expect(page).toHaveURL(`/share/${missingShareLinkId}`);
      await expect(page.getByText('Page is not found')).toBeVisible();
      await expect(pageTitle(page, 'source')).toHaveCount(0);
      await expect(page.getByText(sourceSentence)).toHaveCount(0);
      expect(await isWindowMarked(page)).toBe(true);
    });

    test('from a regular page, an expired share link shows the expired page without the previous page', async ({
      page,
    }) => {
      const msUntilExpired = shareLinkExpiredAt.getTime() - Date.now();
      if (msUntilExpired > 0) {
        await page.waitForTimeout(msUntilExpired + 500);
      }

      await page.goto(sourcePath);
      await expect(pageTitle(page, 'source')).toBeVisible();
      await markWindow(page);

      await page.getByRole('link', { name: 'to expired share' }).click();

      await expect(page).toHaveURL(`/share/${expiredShareLinkId}`);
      await expect(page.getByText('Page is expired')).toBeVisible();
      await expect(pageTitle(page, 'expired-shared')).toBeVisible();
      await expect(pageTitle(page, 'source')).toHaveCount(0);
      await expect(page.getByText(sourceSentence)).toHaveCount(0);
      expect(await isWindowMarked(page)).toBe(true);
    });
  });
