import { expect, test } from '@playwright/test';

/**
 * E2E test for the user-route Reconcile flow from the page sub-navigation.
 *
 * Covers Task 5.3 scenario:
 *   - A logged-in user opens the page-control dropdown from the contextual
 *     sub-nav, clicks "Reconcile Vault", and sees the accepted feedback in
 *     the modal (or, in a non-bootstrap env, the i18n-translated reject).
 *
 * Implementation note:
 *   The auth setup pre-authenticates only the `admin` user. The user-route
 *   API endpoint (`/v3/vault/page/reconcile`) accepts any authenticated user
 *   so this scenario exercises the same code path as a non-admin user.
 *   A future follow-up could provision a dedicated non-admin storageState
 *   to assert authorization boundaries strictly.
 *
 *   The dropdown is opened via the contextual sub-nav (`grw-contextual-sub-nav`),
 *   following the same pattern used in `23-editor/with-navigation.spec.ts`. This
 *   is preferred over the sidebar PageTree item dropdown because the sub-nav
 *   trigger has a stable test-id and does not require hover interactions.
 */

test.describe('User Vault Reconcile from page sub-nav', () => {
  // Requirements: 1.2, 5.3, 6.2
  test('user can open the page-control dropdown and trigger reconcile for the current page', async ({
    page,
  }) => {
    // Open the top page so the contextual sub-nav has a page-id and the
    // additional menu items renderer surfaces the Reconcile Vault entry.
    await page.goto('/');

    // Open page-control dropdown from sub-nav
    await page
      .getByTestId('grw-contextual-sub-nav')
      .getByTestId('open-page-item-control-btn')
      .click();

    const reconcileMenuItem = page.getByTestId('page-reconcile-menu-item');
    await expect(reconcileMenuItem).toBeVisible();
    await reconcileMenuItem.click();

    // Modal opens; default target path is pre-filled from the current page
    const modal = page.getByTestId('reconcile-trigger-modal');
    await expect(modal).toBeVisible();

    const pathInput = modal.locator('#reconcile-target-path');
    const prefilled = await pathInput.inputValue();
    expect(prefilled.length).toBeGreaterThan(0);

    // Submit the reconcile request
    await modal.getByTestId('reconcile-submit-button').click();

    // Either accepted feedback (bootstrap done) or a known i18n reject is shown
    const acceptedAlert = modal.getByTestId('reconcile-accepted-message');
    const errorAlert = modal.getByTestId('reconcile-error-message');

    await expect(acceptedAlert.or(errorAlert)).toBeVisible({ timeout: 15_000 });

    if (await errorAlert.isVisible()) {
      // Validate that the reject reason is one of the known i18n messages.
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
    }
  });
});
