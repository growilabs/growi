import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from '@playwright/test';

import { collapseSidebar } from '../utils';
import {
  allowAnyoneToDeletePages,
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  type PageDeletionAuthorities,
  restorePageDeletionAuthorities,
  setChangeProposalEnabled,
} from '../utils/api';
import { FILTER_TEST_USER_B } from '../utils/test-users';
import {
  findCurrentRevisionId,
  removeProposalAndReverts,
  writeAppliedProposal,
} from './applied-proposal-fixture';

// The requester is the admin; a second, non-admin user follows the marks and
// reverts. Reverting the create deletes the page completely, which needs the
// reverter to hold both deletion authorities (core requirement 5.16).
const REQUESTER_USERNAME = 'admin';
const SECOND_USER = FILTER_TEST_USER_B;
// The revert result is re-fetched every 3 seconds for up to 60 seconds.
const REVERT_SETTLE_TIMEOUT = 60_000;

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const editedName = `e2e-change-proposal-${runId}-edited`;
const createdName = `e2e-change-proposal-${runId}-created`;
const editedPath = `/${editedName}`;
const createdPath = `/${createdName}`;

const recentChangesRow = (page: Page, name: string) =>
  page
    .getByTestId('grw-recent-changes')
    .locator('li.list-group-item')
    .filter({ hasText: name });

const operationItem = (page: Page, path: string) =>
  page
    .getByTestId('change-proposal-operation')
    .filter({ has: page.locator('code', { hasText: path }) });

test.describe('Revert an applied Change Proposal from its detail page', () => {
  let edited: CreatedPage;
  let created: CreatedPage;
  let proposalId: string;
  let previousChangeProposalEnabled: boolean;
  let previousDeletionAuthorities: PageDeletionAuthorities;

  test.beforeAll(async ({ request }) => {
    previousChangeProposalEnabled = await setChangeProposalEnabled(
      request,
      true,
    );
    previousDeletionAuthorities = await allowAnyoneToDeletePages(request);

    edited = await createPage(request, {
      path: editedPath,
      body: '# Edited\n\nbase line\n',
    });
    created = await createPage(request, {
      path: createdPath,
      body: '# Created\n\ncreated line\n',
    });
    ({ proposalId } = await writeAppliedProposal({
      requesterUsername: REQUESTER_USERNAME,
      edited: {
        pageId: edited.pageId,
        path: editedPath,
        proposedBody: '# Edited\n\nproposed line\n',
      },
      created: {
        pageId: created.pageId,
        path: createdPath,
        body: '# Created\n\ncreated line\n',
      },
    }));
  });

  const deleteRemainingPages = async (
    request: APIRequestContext,
  ): Promise<void> => {
    const remaining: CreatedPage[] = [];
    for (const target of [edited, created]) {
      if (target == null) continue;
      // biome-ignore lint/performance/noAwaitInLoops: two pages at most
      const revisionId = await findCurrentRevisionId(target.pageId);
      if (revisionId != null) {
        remaining.push({ ...target, revisionId });
      }
    }
    await deletePagesCompletely(request, remaining);
  };

  // Each restore runs even when another one fails, so a retry never reads a
  // setting this run left changed as the value to restore.
  const restoreSettings = async (request: APIRequestContext): Promise<void> => {
    const results = await Promise.allSettled([
      previousDeletionAuthorities == null
        ? Promise.resolve()
        : restorePageDeletionAuthorities(request, previousDeletionAuthorities),
      previousChangeProposalEnabled == null
        ? Promise.resolve()
        : setChangeProposalEnabled(request, previousChangeProposalEnabled),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to restore the settings');
    }
  };

  test.afterAll(async ({ request }) => {
    try {
      try {
        await deleteRemainingPages(request);
      } finally {
        if (proposalId != null) {
          await removeProposalAndReverts(proposalId);
        }
      }
    } finally {
      await restoreSettings(request);
    }
  });

  test('a second user follows the mark to the detail page, reverts everything and sees the marks and the detail updated', async ({
    browser,
  }) => {
    // The dev server compiles each page on its first visit.
    test.setTimeout(240_000);
    const context = await browser.newContext({
      storageState: SECOND_USER.authFile,
    });
    const page = await context.newPage();

    try {
      // Recent Changes: both rows carry the Change Proposal mark
      await page.goto('/');
      await collapseSidebar(page, false);
      await page.getByTestId('grw-sidebar-nav-primary-recent-changes').click();
      const editedRow = recentChangesRow(page, editedName);
      const createdRow = recentChangesRow(page, createdName);
      const editedMark = editedRow.getByRole('link', {
        name: 'Change Proposal',
        exact: true,
      });
      await expect(editedMark).toBeVisible({ timeout: 30_000 });
      await expect(
        createdRow.getByRole('link', { name: 'Change Proposal', exact: true }),
      ).toBeVisible();

      // The mark leads to the detail page
      await editedMark.click();
      await page.waitForURL(`**/me/change-proposals/${proposalId}`);
      // The in-place refresh checked after the revert needs the panel here too
      await expect(page.getByTestId('grw-recent-changes')).toBeVisible();
      const editedItem = operationItem(page, editedPath);
      const createdItem = operationItem(page, createdPath);
      await expect(editedItem).toBeVisible({ timeout: 60_000 });
      await expect(createdItem).toBeVisible();

      // The diff of the edit shows the proposed line
      await editedItem.getByRole('button', { name: 'Show diff' }).click();
      await expect(editedItem).toContainText('proposed line', {
        timeout: 30_000,
      });

      // Revert everything that can be reverted, confirming both paths
      await page
        .getByRole('button', { name: 'Revert everything that can be reverted' })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(editedPath);
      await expect(dialog).toContainText(createdPath);
      await dialog.getByRole('button', { name: 'Revert', exact: true }).click();

      const resultList = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'Result of the revert' }),
      });
      for (const path of [editedPath, createdPath]) {
        // biome-ignore lint/performance/noAwaitInLoops: one assertion per reverted operation
        await expect(
          resultList.locator('li').filter({ hasText: path }),
        ).toContainText('Reverted', { timeout: REVERT_SETTLE_TIMEOUT });
      }

      // Recent Changes is refreshed without a reload: the edited page now
      // carries the revert mark and the created page is gone
      await expect(
        editedRow.getByRole('link', { name: 'Revert', exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        editedRow.getByRole('link', { name: 'Change Proposal', exact: true }),
      ).toHaveCount(0);
      await expect(createdRow).toHaveCount(0);

      // After a reload both operations stay reverted, with their paths
      await page.reload();
      for (const path of [editedPath, createdPath]) {
        // biome-ignore lint/performance/noAwaitInLoops: one assertion per reverted operation
        await expect(
          operationItem(page, path).getByText('Reverted', { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
      }
    } finally {
      await context.close();
    }
  });
});
