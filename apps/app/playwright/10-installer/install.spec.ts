import { expect, test } from '@playwright/test';

test('Installer', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('/installer');

  // show installer form
  await expect(page.getByTestId('installerForm')).toBeVisible();

  // choose Japanese
  await page.getByTestId('dropdownLanguage').click();
  await page.getByTestId('dropdownLanguageMenu-ja_JP').click();
  await expect(page.getByRole('textbox', { name: 'ユーザーID' })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'ユーザーID' }),
  ).toHaveAttribute('placeholder', 'ユーザーID');

  // choose Chinese
  await page.getByTestId('dropdownLanguage').click();
  await page.getByTestId('dropdownLanguageMenu-zh_CN').click();
  await expect(page.getByRole('textbox', { name: '用户ID' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '用户ID' })).toHaveAttribute(
    'placeholder',
    '用户ID',
  );
  // // choose English
  await page.getByTestId('dropdownLanguage').click();
  await page.getByTestId('dropdownLanguageMenu-en_US').click();
  await expect(page.getByRole('textbox', { name: 'User ID' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'User ID' })).toHaveAttribute(
    'placeholder',
    'User ID',
  );

  await page.getByRole('textbox', { name: 'User ID' }).focus();

  // fill form
  await page.getByLabel('User ID').fill('admin');
  await page.getByLabel('User ID').press('Tab');
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused();

  await page.getByLabel('Name').fill('Admin');
  await page.getByLabel('Name').press('Tab');
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeFocused();

  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Email').press('Tab');
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeFocused();

  await page.getByLabel('Password').fill('adminadmin');
  await page.getByLabel('Password').press('Enter');

  await page.waitForURL('/', { timeout: 20000 });
  await expect(page).toHaveTitle(/\/ - GROWI/);
});
