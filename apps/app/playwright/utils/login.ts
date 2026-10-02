import path from 'node:path';
import type { Page } from '@playwright/test';

const adminAuthFile = path.resolve(import.meta.dirname, '../.auth/admin.json');

interface LoginOptions {
  usernameOrEmail?: string;
  password?: string;
  /** where to persist the authenticated storageState; defaults to admin.json */
  authFile?: string;
}

/**
 * Fill and submit the login form, then wait until the app navigates away from
 * the login page. Does NOT persist storageState.
 *
 * Exposed separately from {@link login} so callers that must keep acting on the
 * resulting session without writing an auth file (e.g. logging in as a freshly
 * invited user to complete their registration) can drive the form directly.
 */
export const fillLoginForm = async (
  page: Page,
  usernameOrEmail: string,
  password: string,
): Promise<void> => {
  await page.goto('/login');

  const loginForm = page.getByTestId('login-form');
  await loginForm.getByPlaceholder('Username or E-mail').fill(usernameOrEmail);
  await loginForm.getByPlaceholder('Password').fill(password);
  await loginForm.locator('[type=submit]').filter({ hasText: 'Login' }).click();

  // A successful login redirects away from the login page; wrong credentials
  // keep us on /login, so this also fails fast on a bad login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
};

/**
 * Authenticate and persist the session to a storageState file so other browser
 * contexts can reuse it via `browser.newContext({ storageState })`.
 * Defaults to the admin account / admin.json.
 */
export const login = async (
  page: Page,
  options: LoginOptions = {},
): Promise<void> => {
  const {
    usernameOrEmail = 'admin',
    password = 'adminadmin',
    authFile = adminAuthFile,
  } = options;

  await fillLoginForm(page, usernameOrEmail, password);

  await page.context().storageState({ path: authFile });
};
