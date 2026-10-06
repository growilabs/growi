import { expect, type Page, test } from '@playwright/test';

import type { CreatedPage } from '../utils/api';
import { createPage, deletePagesCompletely } from '../utils/api';
import { rebuildSearchIndex } from '../utils/api/search-index';

/**
 * Cross-surface checks for the shared comment list:
 * the page-bottom thread, the body highlight and the side-panel count all
 * read the same list, and views that never showed inline comments (share
 * link, search preview) still do not. Ordering of mixed normal/inline items
 * is covered by `inline-comment.spec.ts` ("shares one list ...").
 */

const selectTextInPageBody = async (
  page: Page,
  text: string,
): Promise<void> => {
  await page.evaluate((needle) => {
    const container = document.querySelector('.wiki');
    if (container == null) {
      throw new Error('page body container (.wiki) not found');
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node != null) {
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`text not found in page body: ${needle}`);
  }, text);
};

const savedHighlightSize = (page: Page): Promise<number> =>
  page.evaluate(() => CSS.highlights.get('growi-inline-comment')?.size ?? 0);

test.describe('Comment list shared by the thread, the body and the count', () => {
  test.describe.configure({ mode: 'serial' });

  const pagePath = (retry: number) => `/comment-list-integration-e2e${retry}`;

  // A single unusual word so the search preview can find exactly this page.
  const searchToken = 'commentlistintegrationtoken';
  const targetSentence = `This sentence anchors the ${searchToken} inline comment.`;
  const pageBody = [
    '# Comment list integration E2E',
    '',
    targetSentence,
    '',
  ].join('\n');

  const normalCommentText = 'a normal comment for the comment list e2e';
  const inlineCommentText = 'an inline comment for the comment list e2e';
  const inlineReplyText =
    'a reply to the inline comment for the comment list e2e';

  const commentCountBadge = (page: Page) =>
    page.getByTestId('page-comment-button').locator('.grw-count-badge');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page and post one normal comment', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: pagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await page.getByTestId('page-comment-button').click();
    await page.getByTestId('open-comment-editor-button').click();
    await page.locator('.cm-content').fill(normalCommentText);
    await page.getByTestId('comment-submit-button').first().click();
    await expect(page.locator('.page-comment-body')).toContainText(
      normalCommentText,
    );
  });

  test('Creating an inline comment and a reply updates the highlight, the thread and the count together (Req 6.1, 6.4, 7.1, 7.2)', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    await expect(commentCountBadge(page)).toHaveText('1');
    expect(await savedHighlightSize(page)).toBe(0);

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill(inlineCommentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    // No reload in between: all three surfaces must follow the one write.
    const item = page.getByTestId('inline-comment-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(inlineCommentText);
    await expect.poll(() => savedHighlightSize(page)).toBeGreaterThan(0);
    await expect(commentCountBadge(page)).toHaveText('2');

    // The thread interleaves both kinds by posting time.
    const listItems = page.locator(
      '.page-comments > #page-comments-list > div',
    );
    await expect(listItems).toHaveCount(2);
    await expect(listItems.nth(0)).toContainText(normalCommentText);
    await expect(listItems.nth(1)).toContainText(inlineCommentText);

    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill(inlineReplyText);
    await item.getByTestId('comment-submit-button').first().click();
    await expect(item.getByTestId('inline-comment-reply')).toContainText(
      inlineReplyText,
    );
    await expect(commentCountBadge(page)).toHaveText('3');
  });

  test('Resolving clears the highlight and marks the thread item, while the count keeps the resolved comment (Req 6.4, 7.3)', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    await expect.poll(() => savedHighlightSize(page)).toBeGreaterThan(0);
    await expect(commentCountBadge(page)).toHaveText('3');

    const item = page.getByTestId('inline-comment-item');
    // The item's action buttons are shown only while its box is hovered.
    await item.locator('.page-comment-main').first().hover();
    await item.getByTestId('inline-comment-resolve-toggle-button').click();

    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Resolved',
    );
    await expect.poll(() => savedHighlightSize(page)).toBe(0);
    await expect(commentCountBadge(page)).toHaveText('3');
  });

  test('Every count surface agrees with the shared list (Req 7.1, 7.6)', async ({
    request,
  }) => {
    if (createdPage == null) throw new Error('page was not created');
    const { pageId } = createdPage;

    const listRes = await request.get('/_api/v3/comments', {
      params: { pageId },
    });
    expect(listRes.ok()).toBe(true);
    const { comments } = await listRes.json();
    expect(comments).toHaveLength(3);

    const infoRes = await request.get('/_api/v3/page/info', {
      params: { pageId },
    });
    expect(infoRes.ok()).toBe(true);
    expect((await infoRes.json()).commentCount).toBe(3);

    // Source of the sidebar's "recent changes" count. The list is ordered by
    // update time, so a wide window keeps this page in it when other specs
    // create pages in parallel.
    const recentRes = await request.get('/_api/v3/pages/recent', {
      params: { limit: 500 },
    });
    expect(recentRes.ok()).toBe(true);
    const { pages } = await recentRes.json();
    const recent = pages.find((p: { _id: string }) => p._id === pageId);
    expect(recent?.commentCount).toBe(3);
  });

  test('The share-link view shows the normal comment but no inline comment (Req 6.5)', async ({
    browser,
    request,
  }) => {
    if (createdPage == null) throw new Error('page was not created');

    const shareLinkRes = await request.post('/_api/v3/share-links', {
      data: { relatedPage: createdPage.pageId },
    });
    expect(
      shareLinkRes.ok(),
      `share link creation failed: ${shareLinkRes.status()} ${await shareLinkRes.text()}`,
    ).toBe(true);
    const shareLink = await shareLinkRes.json();
    const shareLinkId: string = shareLink.id ?? shareLink._id;

    // A separate cookie-less context: logging out would end the session
    // the other specs reuse from the shared auth state.
    const guestContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: 'http://localhost:3000',
    });
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(`/share/${shareLinkId}`);
      await expect(guestPage.locator('.wiki').first()).toContainText(
        targetSentence,
      );
      await expect(guestPage.getByText(normalCommentText)).toBeVisible();
      await expect(guestPage.getByTestId('inline-comment-item')).toHaveCount(0);
      await expect(guestPage.getByText(inlineCommentText)).toHaveCount(0);
      expect(await savedHighlightSize(guestPage)).toBe(0);
    } finally {
      await guestContext.close();
    }
  });

  test('The search-result preview shows the normal comment but no inline comment (Req 6.5)', async ({
    page,
    request,
  }) => {
    await rebuildSearchIndex(request);

    const preview = page.getByTestId('search-result-content');
    await expect(async () => {
      await page.goto(`/_search?q=${searchToken}`);
      await expect(preview.locator('.wiki').first()).toContainText(
        targetSentence,
        { timeout: 3000 },
      );
    }).toPass({ timeout: 60_000 });

    await expect(preview.getByText(normalCommentText)).toBeVisible();
    await expect(preview.getByTestId('inline-comment-item')).toHaveCount(0);
    await expect(preview.getByText(inlineCommentText)).toHaveCount(0);
  });
});
