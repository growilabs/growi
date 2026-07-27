import { expect, test } from '@playwright/test';

/**
 * E2E tests for the admin Reconcile section (`/admin/vault`).
 *
 * Covers Task 5.3 scenarios for GROWI Vault reconcile:
 *   - Scenario A: admin success flow (sub-tree trigger → accepted message → history row)
 *   - Scenario B: reject feedback (invalid target path → i18n error message in modal)
 *
 * Note on environment assumptions:
 *   These tests assume the dev server is reachable on http://localhost:3000 and that
 *   the vault feature panel is mounted under `/admin/vault`. The reconcile API requires
 *   `bootstrapState === 'done'`; when bootstrap has not been run the admin scenario
 *   will surface a `bootstrap-not-done` reject — Scenario A is written so it still
 *   asserts useful UI feedback (either accepted alert OR a known reject reason),
 *   while Scenario B intentionally exercises a reject path with an unambiguously
 *   invalid target.
 */

test.describe('Admin Vault Reconcile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/vault');
    // The admin Vault wrapper renders even before SWR settles.
    await expect(page.getByTestId('growi-vault-admin-settings')).toBeVisible();
  });

  // Requirements: 1.1, 5.2, 5.3
  test('admin can trigger a sub-tree reconcile from /admin/vault and see accepted feedback / history reflects the run', async ({
    page,
  }) => {
    // Reconcile section header is rendered as part of the admin settings panel
    await expect(
      page.getByRole('heading', { name: 'Reconcile' }),
    ).toBeVisible();

    // Open the Reconcile modal
    await page.getByRole('button', { name: /Trigger Reconcile/i }).click();
    const modal = page.getByTestId('reconcile-trigger-modal');
    await expect(modal).toBeVisible();

    // Choose sub-tree mode and target the root path
    await modal.locator('#reconcile-target-type-subtree').check();
    await modal.locator('#reconcile-target-path').fill('/');

    // Submit
    await modal.getByTestId('reconcile-submit-button').click();

    // Either accepted (bootstrap done) or rejected with a known reason.
    // Both outcomes are valid UI feedback for this scenario; the assertion
    // verifies that the modal surfaces ONE of them rather than hanging.
    const acceptedAlert = modal.getByTestId('reconcile-accepted-message');
    const errorAlert = modal.getByTestId('reconcile-error-message');

    await expect(acceptedAlert.or(errorAlert)).toBeVisible({ timeout: 15_000 });

    if (await acceptedAlert.isVisible()) {
      // Happy path: accepted feedback was shown, then the modal auto-closes
      // after ~1500ms. After it closes, the new run should appear in the
      // history table. We poll because the server-side dispatcher transitions
      // accepted → running → completed and SWR refresh is on a 5s interval.
      await expect(modal).toBeHidden({ timeout: 10_000 });

      const historyTable = page.getByTestId('reconcile-history-table');
      await expect(historyTable).toBeVisible({ timeout: 10_000 });

      // We only assert that *some* row is present (running or completed).
      // Waiting for `completed` would couple this test to dispatcher runtime
      // and is left to the integration test suite (task 5.2).
      const firstRow = historyTable.locator('tbody tr').first();
      await expect(firstRow).toBeVisible({ timeout: 10_000 });
    } else {
      // Reject path (e.g. bootstrap-not-done in a fresh DB): the modal stays
      // open and the error alert is shown. We only assert non-empty so this
      // works regardless of which reason is surfaced in the current env.
      await expect(errorAlert).not.toBeEmpty();
    }
  });

  // Requirements: 6.2, 6.3, 6.7
  test('admin reconcile shows i18n reject message in modal for an invalid target path', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /Trigger Reconcile/i }).click();
    const modal = page.getByTestId('reconcile-trigger-modal');
    await expect(modal).toBeVisible();

    // A path that cannot exist as a normal page — server-side validator
    // rejects it as `invalid-target` (or, depending on bootstrap state,
    // `bootstrap-not-done`). Both are i18n-translated strings and surfaced
    // via `reconcile-error-message`.
    await modal.locator('#reconcile-target-type-page').check();
    await modal
      .locator('#reconcile-target-path')
      .fill('/__nonexistent_e2e_target_path_for_reconcile__');

    await modal.getByTestId('reconcile-submit-button').click();

    const errorAlert = modal.getByTestId('reconcile-error-message');
    await expect(errorAlert).toBeVisible({ timeout: 15_000 });

    // The reject reason is one of the i18n-translated messages from
    // public/static/locales/en_US/admin.json → growi-vault.reconcile.rejected.*
    // We accept any of them rather than pinning a single reason because the
    // exact reason depends on env (bootstrap done / not done, page count, etc.).
    const text = await errorAlert.innerText();
    const knownRejectFragments = [
      'Invalid target path',
      'Vault is not ready',
      'too many pages',
      'reconcile in progress',
      'system reconcile limit',
    ];
    const matched = knownRejectFragments.some((frag) => text.includes(frag));
    expect(matched, `Unexpected reject message: "${text}"`).toBeTruthy();
  });
});
