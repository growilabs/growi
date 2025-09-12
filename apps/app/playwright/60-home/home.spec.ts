import { test, expect } from '@playwright/test';


test('Visit User home', async({ page }) => {
  await page.goto('dummy');

  // Open PersonalDropdown
  await page.getByTestId('personal-dropdown-button').click();
  await expect(page.getByTestId('grw-personal-dropdown-menu-user-home')).toBeVisible();

  // Click UserHomeMenu
  await page.getByTestId('grw-personal-dropdown-menu-user-home').click();
  await expect(page.getByTestId('grw-users-info')).toBeVisible();
});

test('Vist User settings', async({ page }) => {
  await page.goto('dummy');

  // Open PersonalDropdown
  await page.getByTestId('personal-dropdown-button').click();
  await expect(page.getByTestId('grw-personal-dropdown-menu-user-home')).toBeVisible();

  // Click UserSettingsMenu
  page.getByTestId('grw-personal-dropdown-menu-user-settings').click();
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
});

test('Access User information', async({ page }) => {
  await page.goto('/me');

  // Click BasicInfoSettingUpdateButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();

  // Expect a success toaster to be displayed when the BasicInfoSettingUpdateButton is pressed
  await page.getByTestId('grw-besic-info-settings-update-button').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();
});

test('Access External account', async({ page }) => {
  await page.goto('/me');

  // Click ExternalAccountsTabButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
  await page.getByTestId('external-accounts-tab-button').first().click();

  // Expect an error toaster to be displayed when the AddExternalAccountsButton is pressed
  await page.getByTestId('grw-external-account-add-button').click();
  await expect(page.getByTestId('grw-associate-modal')).toBeVisible();
  await page.getByTestId('add-external-account-button').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();
  await page.locator('.Toastify__close-button').click();
  await expect(page.locator('.Toastify__toast')).not.toBeVisible();
});

test('Access Password setting', async({ page }) => {
  await page.goto('/me');

  // Click PasswordSettingTabButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
  await page.getByTestId('password-settings-tab-button').first().click();

  // Expect three error toasters to be displayed when the PasswordUpdateButton is pressed
  await page.getByTestId('grw-password-settings-update-button').click();
  const toastElements = page.locator('.Toastify__toast');

  const toastElementsCount = await toastElements.count();
  for (let i = 0; i < toastElementsCount; i++) {
    // eslint-disable-next-line no-await-in-loop
    await toastElements.nth(i).click();
  }

  await expect(page.getByTestId('.Toastify__toast')).not.toBeVisible();
});


test('Access API setting', async({ page }) => {
  await page.goto('/me');

  // Click ApiSettingTabButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
  await page.getByTestId('api-settings-tab-button').first().click();

  // Expect a success toaster to be displayed when the UpdateApiTokenButton is clicked
  await page.getByTestId('grw-api-settings-update-button').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();
});

test('Access Access Token setting', async({ page }) => {
  await page.goto('/me');

  // Click ApiSettingTabButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
  await page.getByTestId('api-settings-tab-button').first().click();

  // Expect a success toaster to be displayed when new Access Token is generated
  await page.getByTestId('btn-accesstoken-toggleform').click();
  await page.getByTestId('grw-accesstoken-textarea-description').fill('dummy');
  await page.getByTestId('grw-accesstoken-checkbox-read:*').check();
  await page.getByTestId('grw-accesstoken-create-button').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();
  await expect(page.getByTestId('grw-accesstoken-new-token-display')).toBeVisible();

  // Expect a success toaster to be displayed when the Access Token is deleted
  await page.getByTestId('grw-accesstoken-delete-button').click();
  await page.getByTestId('grw-accesstoken-cancel-button-in-modal').click();
  await page.getByTestId('grw-accesstoken-delete-button').click();
  await page.getByTestId('grw-accesstoken-delete-button-in-modal').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();

});

test('Access In-App Notification setting', async({ page }) => {
  await page.goto('/me');

  // Click InAppNotificationSettingTabButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
  await page.getByTestId('in-app-notification-settings-tab-button').first().click();

  // Expect a success toaster to be displayed when the InAppNotificationSettingsUpdateButton is clicked
  await page.getByTestId('grw-in-app-notification-settings-update-button').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();
});

test('Acccess Other setting', async({ page }) => {
  await page.goto('/me');

  // Click OtherSettingTabButton
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
  await page.getByTestId('other-settings-tab-button').first().click();

  // Expect a success toaster to be displayed when the updating UI button is clicked
  await page.getByTestId('grw-ui-settings-update-btn').click();
  await expect(page.locator('.Toastify__toast')).toBeVisible();
});
