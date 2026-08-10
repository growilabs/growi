import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/api/create-page';

/**
 * Links to pages whose path holds non-ASCII characters used to fall back to a
 * browser transition, because the renderer percent-encodes the href and the
 * routing decision was made against the encoded form. Nothing else in the
 * e2e suite exercises a non-ASCII page path.
 */
const ROOT = '/PageLinkTransition';
const ASCII_CHILD = 'AsciiChild';
const NON_ASCII_CHILD = '日本語ページ';
const ASCII_BODY = 'body of the ascii child';
const NON_ASCII_BODY = 'body of the non-ascii child';

const created: CreatedPage[] = [];

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: 'playwright/.auth/admin.json',
  });
  const { request } = ctx;

  created.push(
    await createPage(request, {
      path: `${ROOT}/${ASCII_CHILD}`,
      body: ASCII_BODY,
    }),
  );
  created.push(
    await createPage(request, {
      path: `${ROOT}/${NON_ASCII_CHILD}`,
      body: NON_ASCII_BODY,
    }),
  );
  created.push(
    await createPage(request, {
      path: ROOT,
      body: [
        `- [[${ASCII_CHILD}]]`,
        `- [[${NON_ASCII_CHILD}]]`,
        `- [markdown-ascii](${ROOT}/${ASCII_CHILD})`,
        `- [markdown-non-ascii](${ROOT}/${NON_ASCII_CHILD})`,
      ].join('\n'),
    }),
  );

  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: 'playwright/.auth/admin.json',
  });
  await deletePagesCompletely(ctx.request, created.slice().reverse());
  await ctx.close();
});

test('Links in a page body reach their target without reloading the document', async ({
  page,
}) => {
  for (const [linkText, expectedBody] of [
    [ASCII_CHILD, ASCII_BODY],
    [NON_ASCII_CHILD, NON_ASCII_BODY],
    ['markdown-ascii', ASCII_BODY],
    ['markdown-non-ascii', NON_ASCII_BODY],
  ] as const) {
    await page.goto(ROOT);
    const link = page.locator('.wiki a', { hasText: linkText }).first();
    await link.waitFor();

    // a browser transition builds a new document and drops this mark;
    // a client-side transition keeps the document, and the mark with it
    await page.evaluate(() => {
      document.documentElement.dataset.transitionProbe = 'kept';
    });

    await link.click();
    await expect(page.locator('.wiki')).toContainText(expectedBody);

    const probe = await page.evaluate(
      () => document.documentElement.dataset.transitionProbe,
    );
    // soft so that every link is reported, not just the first broken one
    expect
      .soft(probe, `"${linkText}" must not reload the document`)
      .toBe('kept');
  }
});
