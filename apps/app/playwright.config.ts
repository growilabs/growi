import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices, type Project } from '@playwright/test';

const authFile = path.resolve(__dirname, './playwright/.auth/admin.json');

// Use prepared auth state.
const storageState = fs.existsSync(authFile) ? authFile : undefined;

const supportedBrowsers = ['chromium', 'firefox', 'webkit'] as const;

const projects: Array<Project> = supportedBrowsers.map((browser) => ({
  name: browser,
  use: { ...devices[`Desktop ${browser}`], storageState },
  testIgnore: /(10-installer|21-basic-features-for-guest)\/.*\.spec\.ts/,
  dependencies: ['setup', 'auth', 'users'],
}));

const projectsForGuestMode: Array<Project> = supportedBrowsers.map(
  (browser) => ({
    name: `${browser}/guest-mode`,
    use: { ...devices[`Desktop ${browser}`] }, // Do not use storageState
    testMatch: /21-basic-features-for-guest\/.*\.spec\.ts/,
  }),
);

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  expect: {
    timeout: 7 * 1000,
  },

  testDir: './playwright',
  outputDir: './playwright/output',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? [['github'], ['blob']] : 'list',

  webServer: {
    command: process.env.GROWI_WEBSERVER_COMMAND ?? 'pnpm run server',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    viewport: { width: 1400, height: 1024 },

    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    // Generic setup that is safe to run before GROWI is installed. The installer
    // project depends on this, so nothing matched here may assume an installed
    // app. Post-install setup (admin login, user provisioning) lives in the
    // dedicated `auth` / `users` projects below, which the installer does NOT
    // depend on.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      testIgnore: /(auth|users)\.setup\.ts/,
    },
    { name: 'auth', testMatch: /auth\.setup\.ts/ },
    // Provisions the author/editor filter test users. Requires an installed app
    // (it logs in as admin to invite users), so it must stay out of the `setup`
    // project that the installer depends on — otherwise it runs against the
    // fresh, uninstalled installer DB and times out on the login form.
    { name: 'users', testMatch: /users\.setup\.ts/ },

    {
      name: 'chromium/installer',
      use: { ...devices['Desktop Chrome'], storageState },
      testMatch: /10-installer\/.*\.spec\.ts/,
      dependencies: ['setup'],
    },

    ...projects,

    ...projectsForGuestMode,

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],
});
