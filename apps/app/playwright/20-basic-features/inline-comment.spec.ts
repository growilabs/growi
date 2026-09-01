import { expect, type Page, test } from '@playwright/test';

import type { CreatedPage } from '../utils/api';
import { createPage, deletePagesCompletely, updatePage } from '../utils/api';

/**
 * Selects `text` inside the rendered page body via a Range set on the
 * exact text-node offsets. A triple-click paragraph-select was tried
 * first and rejected: `Selection.toString()` for a triple-click-selected
 * `<p>` includes a trailing "\n" past the sentence's own text (a Chromium
 * paragraph-select artifact), which corrupts the stored quote and makes
 * every later re-match fail. A script-driven `Selection.addRange()` still
 * fires the native `selectionchange` event `useTextSelection`
 * (SelectionCapture's hook) listens for — it's a real Selection-object
 * mutation, just not a mouse gesture — so this is a faithful trigger, not
 * a bypass of the component under test.
 *
 * Hoisted to module scope (rather than declared per `describe` block) so
 * both the happy-path suite and the best-effort-fallback suite below share
 * one implementation.
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

test.describe('Inline comment', () => {
  // Serial: comment creation is a real, non-idempotent backend write and later
  // tests (reload / reply) depend on the comment created by an earlier test in
  // this file, the same reasoning `20-basic-features/comments.spec.ts` uses.
  test.describe.configure({ mode: 'serial' });

  // Scoped by testInfo.retry (same technique as comments.spec.ts) so a
  // serial-group retry gets a comment-free page instead of inheriting an
  // earlier attempt's inline comments.
  const inlineCommentPagePath = (retry: number) =>
    `/inline-comment-e2e${retry}`;

  const targetSentence =
    'This sentence is the target of an inline comment for end-to-end testing.';
  const pageBody = [
    '# Inline comment E2E',
    '',
    'Some intro text before the target.',
    '',
    targetSentence,
    '',
    'Some trailing text after the target.',
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page containing the target text', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: inlineCommentPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Selecting text shows the create form; submitting it adds the comment to the list', async ({
    page,
  }, testInfo) => {
    await page.goto(inlineCommentPagePath(testInfo.retry));
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);

    // `.wiki` being visible only proves the SSR'd markdown is on the page —
    // SelectionCapture and InlineCommentList mount separately, via
    // `next/dynamic({ ssr: false })` (PageView.tsx), as their own
    // client-only chunk. Waiting for the list to attach is a simple,
    // one-time readiness signal that the inline-comment client bundle has
    // mounted before the one-shot `selectTextInPageBody` (a plain
    // `page.evaluate`, not a Playwright action with built-in retry) fires.
    await expect(page.getByTestId('inline-comment-list')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);

    // Requirement 1.1: a non-empty selection shows the create form.
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await expect(form.locator('.inline-comment-form-quote')).toHaveText(
      targetSentence,
    );

    const commentText = 'an origin inline comment created by the e2e test';
    // InlineCommentForm's comment input is the same CodeMirror-based editor
    // (CodeMirrorEditorComment) the page-end comment thread uses — driven
    // the same way `20-basic-features/comments.spec.ts` drives it.
    await form.locator('.cm-content').fill(commentText);

    // Requirement 1.2: submitting saves the comment (quote/prefix/suffix/offset).
    await form.getByTestId('inline-comment-submit-button').click();

    // The form closes on a successful submit (SelectionCapture.closeForm).
    await expect(form).not.toBeVisible();

    // Requirement 2.5/2.6: the comment appears in the page's inline-comment list.
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);
  });

  test('After reloading the page, the comment persists and its highlight is restored', async ({
    page,
  }, testInfo) => {
    await page.goto(inlineCommentPagePath(testInfo.retry));

    // The comment created in the previous test is still there after a fresh
    // page load (list persistence, requirement 2.5).
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(
      'an origin inline comment created by the e2e test',
    );

    // Requirement 2.1/2.2: on reload, the anchor is re-resolved from the
    // saved quote/prefix/suffix against the freshly-rendered body, and a
    // highlight is drawn for the exact-match range. InlineCommentHighlight
    // registers resolved ranges under CSS.highlights (the CSS Custom
    // Highlight API) rather than mutating the DOM (see that component's own
    // doc comment for why), so the registered highlight itself — not a
    // `<mark>` element — is the only DOM-observable signal that re-anchoring
    // actually succeeded. Poll because the highlight is drawn only after
    // AnchorResolver's container-settle detection fires.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Replying to the inline comment nests the reply under the origin comment in the list', async ({
    page,
  }, testInfo) => {
    await page.goto(inlineCommentPagePath(testInfo.retry));

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    const replyText = 'a reply to the origin inline comment';
    await item.getByRole('textbox', { name: 'Reply' }).fill(replyText);
    await item.getByRole('button', { name: 'Reply' }).click();

    // Requirement 1.8/2.5: the reply (no anchor of its own) is nested under
    // its origin comment's own list item, not appended as a sibling.
    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(replyText);
  });
});

test.describe('Inline comment - best-effort fallback after the anchored text is edited away', () => {
  // Serial for the same reason as the suite above: the second test depends
  // on the comment created by the first, real backend state.
  test.describe.configure({ mode: 'serial' });

  const fallbackPagePath = (retry: number) =>
    `/inline-comment-e2e-fallback${retry}`;

  // Long enough that even the fuzzy matcher's tolerance
  // (`FUZZY_MATCH_ERROR_RATE = 0.2`, capped at `FUZZY_MATCH_MAX_ERRORS = 20`
  // — see quote-matcher.ts) cannot bridge the gap to its replacement below.
  const targetSentence =
    'This sentence will be entirely removed from the page body after the comment is created, breaking its anchor on purpose.';
  const pageBody = [
    '# Inline comment E2E - fallback',
    '',
    'Some intro text before the target.',
    '',
    targetSentence,
    '',
    'Some trailing text after the target.',
    '',
  ].join('\n');

  // A short, wholly unrelated replacement for `targetSentence`. Levenshtein
  // distance is always at least the length difference between the two
  // strings, so `targetSentence.length - replacementSentence.length` alone
  // (119 - 10 = 109) already exceeds `matchQuote`'s worst-case tolerance of
  // `min(ceil(119 * 0.2), 20) = 20` errors — independent of how much (or
  // little) the wording happens to overlap. This makes the "quote is
  // unrecoverable" outcome deterministic rather than a near-miss that could
  // flip to a fuzzy match under an unlucky character overlap.
  const replacementSentence = 'Unrelated.';

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page, then create an inline comment on a sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: fallbackPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-list')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);

    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form
      .locator('.cm-content')
      .fill('a comment whose anchor will be lost');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    // Requirement 2.1/2.2: sanity-check the highlight is actually drawn
    // before the edit — otherwise a "no highlight after edit" assertion
    // later would be true for the wrong reason (it was never drawn at all).
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('After the commented-on text is completely edited away and the page reloads, the highlight disappears but the comment remains listed', async ({
    page,
    request,
  }) => {
    if (createdPage == null) {
      throw new Error('createdPage was not set by the previous test');
    }

    // Requirement 5.1/5.3: replace the whole paragraph that contained the
    // quoted sentence with unrelated text — not merely shifted or
    // reworded, but gone — so neither exact nor fuzzy matching in
    // `matchQuote` can locate it in the freshly-rendered body.
    const editedBody = pageBody.replace(targetSentence, replacementSentence);
    createdPage = await updatePage(request, createdPage, editedBody);

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(
      replacementSentence,
    );
    await expect(page.locator('.wiki').first()).not.toContainText(
      targetSentence,
    );

    // Requirement 2.5: the comment is still in the list (not deleted, not
    // hidden) even though its anchor could no longer be resolved.
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText('a comment whose anchor will be lost');

    // Requirement 2.4/5.3: no highlight is drawn for the now-unresolvable
    // anchor. `item` being visible already proves the inline-comment data
    // (the same fetch `useAnchorResolver` reads its anchors from) has
    // loaded, so by this point AnchorResolver's anchors-content-change
    // effect (`use-anchor-resolver.ts`) has already run at least once against
    // the freshly-rendered body — there is no later trigger that could still
    // produce a highlight. The extra wait below only guards against a
    // (self-healing) re-anchor via a second `useContainerSettle` tick
    // within its `WATCH_TIMEOUT_MS` window flipping this from 0 to
    // non-zero after the first check.
    const highlightCount = () =>
      page.evaluate(
        () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
      );
    expect(await highlightCount()).toBe(0);
    await page.waitForTimeout(1000);
    expect(await highlightCount()).toBe(0);
  });
});

test.describe('Inline comment - highlight correctness on a page with an async lsx widget', () => {
  // Serial for the same reason as the suites above: the second test depends
  // on the comment created by the first, real backend state.
  test.describe.configure({ mode: 'serial' });

  const lsxPagePath = (retry: number) => `/inline-comment-e2e-lsx${retry}`;

  // `$lsx(depth=1)` is remark-lsx's directive syntax (see
  // packages/remark-lsx/src/client/services/renderer/lsx.ts) — a bare `$lsx(...)`
  // on its own line, with no explicit path attribute, lists the current page's
  // own children (packages/preset-templates' "displaying-child-pages" template
  // uses the identical form).
  //
  // The anchored quote is the child page's own basename — text that does not
  // exist ANYWHERE in the DOM until lsx's async fetch (useSWRxLsx, an
  // unconditional axios GET to /_api/lsx) resolves and `LsxListView` replaces
  // the loading placeholder with the real child list (`LsxPage.tsx` renders
  // the basename as the link's visible text). This is deliberately different
  // from anchoring on a static sentence sitting in its own paragraph: a quote
  // in a paragraph lsx never touches would still resolve correctly even if
  // settle detection were completely broken, because `resolveDomPosition`
  // recomputes the Range fresh against whatever DOM exists at match time — a
  // wrong-but-still-findable match isn't distinguishable from a correct one.
  // By contrast, quoting text that plainly does not exist pre-settle means
  // `matchQuote` must return `not_found` before lsx resolves and can only
  // succeed afterward — so this highlight can only ever come from a
  // recompute that happens at or after the real settle point (design.md's
  // `use-container-settle`), not from the settle-independent
  // anchors-content-change trigger racing ahead of it.
  const childBasename = 'AsyncLsxResolvedChildMarker';
  const pageBody = [
    '# Inline comment E2E - async lsx widget',
    '',
    'Some intro text before the lsx block.',
    '',
    '$lsx(depth=1)',
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;
  let createdChildPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    const pages = [createdPage, createdChildPage].filter(
      (p): p is CreatedPage => p != null,
    );
    if (pages.length > 0) {
      await deletePagesCompletely(request, pages);
    }
  });

  test('Create a page with a real lsx block, then comment on the child page name it renders', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: lsxPagePath(testInfo.retry),
      body: pageBody,
    });
    // The child page's basename IS the quoted text — it only appears in the
    // DOM once lsx's async fetch resolves and renders this child's link.
    createdChildPage = await createPage(request, {
      path: `${createdPage.path}/${childBasename}`,
      body: 'A child page whose basename is the inline comment anchor.',
    });

    await page.goto(createdPage.path);

    // Sanity: lsx actually rendered its child (not an error state) — otherwise
    // the "async round-trip with real content" premise of this test wouldn't
    // hold. LsxPage links render the child page's basename as their label
    // rather than its path (the href is the page's ObjectId), so match by
    // visible link text.
    await expect(
      page.locator('.wiki .lsx').getByRole('link', { name: childBasename }),
    ).toBeVisible();

    await expect(page.getByTestId('inline-comment-list')).toBeAttached();

    await selectTextInPageBody(page, childBasename);

    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await expect(form.locator('.inline-comment-form-quote')).toHaveText(
      childBasename,
    );

    await form
      .locator('.cm-content')
      .fill('a comment anchored on the lsx-rendered child page name');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
  });

  test('After reloading with the lsx fetch artificially delayed, the highlight lands at the correct position only once lsx settles', async ({
    page,
  }, testInfo) => {
    if (createdPage == null) {
      throw new Error('createdPage was not set by the previous test');
    }

    // Delay `/_api/lsx` deterministically instead of relying on the fetch
    // happening to still be in flight when we check — a race would make this
    // test flaky in either direction (assert too early and it's a false
    // negative on a fast CI run; assert too late and it never observes the
    // pending state at all).
    const LSX_FETCH_DELAY_MS = 1500;
    await page.route('**/_api/lsx**', async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, LSX_FETCH_DELAY_MS);
      });
      await route.continue();
    });

    await page.goto(lsxPagePath(testInfo.retry));

    const lsxContainer = page.locator('.wiki .lsx').first();
    await expect(lsxContainer).toBeAttached();

    // Confirm the delay is genuinely observed by the app: right after load,
    // lsx is still mid-fetch (the rendering-status attribute this feature's
    // settle detection watches — see `GROWI_IS_CONTENT_RENDERING_ATTR` in
    // design.md — is still "true").
    await expect(lsxContainer).toHaveAttribute(
      'data-growi-is-content-rendering',
      'true',
    );

    // Once the delayed fetch resolves, lsx flips the attribute to "false" —
    // the signal use-container-settle waits for before AnchorResolver
    // recomputes against the now-final DOM (Requirements 2.1/5.1).
    await expect(lsxContainer).toHaveAttribute(
      'data-growi-is-content-rendering',
      'false',
      { timeout: LSX_FETCH_DELAY_MS + 5_000 },
    );

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    // The decisive assertion: the highlighted range's text is exactly the
    // child page's basename — text that, per the fixture design above, did
    // not exist anywhere in the DOM until lsx settled. A highlight with this
    // exact text can only have been computed after lsx's real settle point,
    // not from the settle-independent anchors-content-change trigger (which
    // would have found `not_found` had it run against the pre-settle DOM).
    const highlightedText = await page.evaluate(() => {
      const set = CSS.highlights.get('growi-inline-comment');
      const range = set != null ? [...set][0] : undefined;
      return range?.toString();
    });
    expect(highlightedText).toBe(childBasename);
  });
});
