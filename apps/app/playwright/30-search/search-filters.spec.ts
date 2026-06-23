import { PageGrant } from '@growi/core';
import { expect, test } from '@playwright/test';

import {
  addUserToGroup,
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  ensureUserGroup,
  rebuildSearchIndex,
  updatePage,
} from '../utils/api';
import {
  FILTER_GROUP_NAME,
  FILTER_TEST_USER_A,
  FILTER_TEST_USER_B,
} from '../utils/test-users';

// Why each test rebuilds the index (rather than relying on auto-index + poll):
//
// Page indexing is event-driven — `pageEvent`/`tagEvent` auto-index a page after
// create/update (see search.ts:registerUpdateEvent). But those handlers are
// fire-and-forget and unordered, so when a fixture produces MORE THAN ONE index
// event for the same page, the writes race:
//   - editor: page is created by A (write: editor=A) then updated by B
//     (write: editor=B). If the create-write lands last, the doc keeps editor=A
//     and `editor:<B>` never matches, so a per-page poll never converges.
//   - tag/group: the `create` event indexes the page before tags/grants are
//     persisted; the follow-up `tagEvent` write can be reordered the same way.
// Measured: with auto-index + poll only, the `editor:` case failed ~2/10 runs.
// A full `rebuild` reads the final DB state once and is authoritative, which
// removes the race. `toPass` still polls because rebuild runs asynchronously.
//
// All describes are wrapped in one `test.describe.serial` so the global rebuilds
// never overlap — CI uses `workers: 1`, but locally `workers` is undefined.

test.describe
  .serial('search filters', () => {
    test.describe
      .serial('tag filter relevance', () => {
        // Unique keyword so the matching set is deterministic and survives seed data.
        const stamp = 'e2e-tagfilter-0a1b2c';
        const tag = `mytag-xyz789${stamp}`;
        const targetPath = `/Sandbox/${stamp}-target`;
        const controlPath = `/Sandbox/${stamp}-control`;
        const created: CreatedPage[] = [];

        // Teardown — keep the DB clean so the suite is re-runnable.
        test.afterAll(async ({ request }) => {
          await deletePagesCompletely(request, created);
        });

        test('setup: create a matching page and a control page', async ({
          request,
        }) => {
          // Track each page the moment it exists. If a later step throws,
          // afterAll still tears down the earlier pages — otherwise they leak
          // and the next run collides on the fixed path.
          created.push(
            await createPage(request, {
              path: targetPath,
              body: 'matching page',
              pageTags: [tag], // what `tag:` will match
            }),
          );
          created.push(
            await createPage(request, {
              path: controlPath,
              body: 'control page', // no tag -> must NOT appear
            }),
          );
        });

        test('tag filter returns only the tagged page', async ({
          page,
          request,
        }) => {
          await rebuildSearchIndex(request);

          const list = page.getByTestId('search-result-list');

          // rebuild runs asynchronously on the server; re-run the search until the
          // tagged page shows up (toPass retries the whole block until it passes).
          // POSITIVE: the tagged page appears.
          await expect(async () => {
            await page.goto(`/_search?q=tag:${tag}`);
            await expect(page.getByTestId('search-result-base')).toBeVisible();
            await expect(
              list.getByRole('link', { name: `${stamp}-target` }),
            ).toBeVisible({ timeout: 3000 });
          }).toPass({ timeout: 20_000 });

          // NEGATIVE: the untagged control page does not appear -> proves relevance.
          await expect(
            list.getByRole('link', { name: `${stamp}-control` }),
          ).toHaveCount(0);
        });
      });

    test.describe
      .serial('author filter relevance', () => {
        // `author:<username>` matches the page creator's username.
        const stamp = 'e2e-authorfilter-7f3a2b';
        const byUserAPath = `/Sandbox/${stamp}-by-a`;
        const byUserBPath = `/Sandbox/${stamp}-by-b`;
        const created: CreatedPage[] = [];

        test.afterAll(async ({ request }) => {
          await deletePagesCompletely(request, created);
        });

        test('setup: create pages authored by different users', async ({
          browser,
        }) => {
          // Each context carries a different user's saved session.
          const contextA = await browser.newContext({
            storageState: FILTER_TEST_USER_A.authFile,
          });
          const contextB = await browser.newContext({
            storageState: FILTER_TEST_USER_B.authFile,
          });
          try {
            // Track each page as it is created (see tag setup) so a mid-setup
            // failure still leaves the earlier pages tracked for teardown.
            created.push(
              await createPage(contextA.request, {
                path: byUserAPath,
                body: `author filter ${stamp}`,
              }),
            );
            created.push(
              await createPage(contextB.request, {
                path: byUserBPath,
                body: `author filter ${stamp}`,
              }),
            );
          } finally {
            await contextA.close();
            await contextB.close();
          }
        });

        test('author filter returns only pages by that author', async ({
          page,
          request,
        }) => {
          await rebuildSearchIndex(request);

          const list = page.getByTestId('search-result-list');

          // POSITIVE: only user A's page appears for `author:<A>`.
          await expect(async () => {
            await page.goto(`/_search?q=author:${FILTER_TEST_USER_A.username}`);
            await expect(page.getByTestId('search-result-base')).toBeVisible();
            await expect(
              list.getByRole('link', { name: `${stamp}-by-a` }),
            ).toBeVisible({ timeout: 3000 });
          }).toPass({ timeout: 20_000 });

          // NEGATIVE: user B's page does not appear -> proves the author filter.
          await expect(
            list.getByRole('link', { name: `${stamp}-by-b` }),
          ).toHaveCount(0);
        });
      });

    test.describe
      .serial('editor filter relevance', () => {
        // `editor:<username>` matches the page's last editor (last_update_username).
        const stamp = 'e2e-editorfilter-9c4d1e';
        const editedByBPath = `/Sandbox/${stamp}-edited-by-b`;
        const onlyByAPath = `/Sandbox/${stamp}-only-a`;
        const authoredByBPath = `/Sandbox/${stamp}-authored-by-b`;
        const created: CreatedPage[] = [];

        test.afterAll(async ({ request }) => {
          await deletePagesCompletely(request, created);
        });

        test('setup: page last edited by B, plus author/contributor controls', async ({
          browser,
        }) => {
          const contextA = await browser.newContext({
            storageState: FILTER_TEST_USER_A.authFile,
          });
          const contextB = await browser.newContext({
            storageState: FILTER_TEST_USER_B.authFile,
          });
          try {
            // Track each page as it is created (see tag setup). For updated
            // pages we push both results: deletePagesCompletely dedups by
            // pageId keeping the last entry, so the update's newer revisionId
            // wins — while the create push covers a failure between the two.

            // Created by A, then last-edited by B -> last editor is B (target).
            const createdByA = await createPage(contextA.request, {
              path: editedByBPath,
              body: `editor filter ${stamp}`,
            });
            created.push(createdByA);
            created.push(
              await updatePage(
                contextB.request,
                createdByA,
                `editor filter ${stamp} edited by b`,
              ),
            );

            // Created and edited only by A -> last editor is A (control).
            created.push(
              await createPage(contextA.request, {
                path: onlyByAPath,
                body: `editor filter ${stamp}`,
              }),
            );

            // Authored by B but last-edited by A -> last editor is A.
            // Proves the filter keys on the LAST editor.
            const createdByB = await createPage(contextB.request, {
              path: authoredByBPath,
              body: `editor filter ${stamp}`,
            });
            created.push(createdByB);
            created.push(
              await updatePage(
                contextA.request,
                createdByB,
                `editor filter ${stamp} edited by a`,
              ),
            );
          } finally {
            await contextA.close();
            await contextB.close();
          }
        });

        test('editor filter returns only pages last edited by that user', async ({
          page,
          request,
        }) => {
          await rebuildSearchIndex(request);

          const list = page.getByTestId('search-result-list');

          // POSITIVE: only the page last edited by B appears for `editor:<B>`.
          await expect(async () => {
            await page.goto(`/_search?q=editor:${FILTER_TEST_USER_B.username}`);
            await expect(page.getByTestId('search-result-base')).toBeVisible();
            await expect(
              list.getByRole('link', { name: `${stamp}-edited-by-b` }),
            ).toBeVisible({ timeout: 3000 });
          }).toPass({ timeout: 20_000 });

          // NEGATIVE: a page only A ever edited does not appear.
          await expect(
            list.getByRole('link', { name: `${stamp}-only-a` }),
          ).toHaveCount(0);

          // NEGATIVE: a page authored & contributed to by B, but last-edited by A,
          // does not appear -> proves `editor:` is the LAST editor, not the author.
          await expect(
            list.getByRole('link', { name: `${stamp}-authored-by-b` }),
          ).toHaveCount(0);
        });
      });

    test.describe
      .serial('group filter relevance', () => {
        // `group:<name>` matches pages granted to that user group.
        const stamp = 'e2e-groupfilter-2b8e6d';
        const inGroupPath = `/Sandbox/${stamp}-in-group`;
        const publicControlPath = `/Sandbox/${stamp}-public`;
        const created: CreatedPage[] = [];

        // Delete as user A (creator + group member).
        test.afterAll(async ({ browser }) => {
          const contextA = await browser.newContext({
            storageState: FILTER_TEST_USER_A.authFile,
          });
          try {
            await deletePagesCompletely(contextA.request, created);
          } finally {
            await contextA.close();
          }
        });

        test('setup: a group page (A is a member) and a public control', async ({
          request,
          browser,
        }) => {
          // Admin creates the group and adds user A as a member.
          const groupId = await ensureUserGroup(request, FILTER_GROUP_NAME);
          await addUserToGroup(request, groupId, FILTER_TEST_USER_A.username);

          // Login as user A.
          const contextA = await browser.newContext({
            storageState: FILTER_TEST_USER_A.authFile,
          });
          try {
            // Track each page as it is created (see tag setup).
            // Page restricted to the group -> only group members can find it.
            created.push(
              await createPage(contextA.request, {
                path: inGroupPath,
                body: `group filter ${stamp}`,
                grant: PageGrant.GRANT_USER_GROUP,
                grantUserGroupIds: [{ type: 'UserGroup', item: groupId }],
              }),
            );
            // Public page.
            created.push(
              await createPage(contextA.request, {
                path: publicControlPath,
                body: `group filter ${stamp}`,
              }),
            );
          } finally {
            await contextA.close();
          }
        });

        test('group filter returns only pages granted to that group', async ({
          request,
          browser,
        }) => {
          await rebuildSearchIndex(request);

          // Search as user A (a group member).
          const contextA = await browser.newContext({
            storageState: FILTER_TEST_USER_A.authFile,
          });
          try {
            const pageA = await contextA.newPage();
            const list = pageA.getByTestId('search-result-list');

            // POSITIVE: the group-restricted page appears for `group:<name>`.
            await expect(async () => {
              await pageA.goto(`/_search?q=group:${FILTER_GROUP_NAME}`);
              await expect(
                pageA.getByTestId('search-result-base'),
              ).toBeVisible();
              await expect(
                list.getByRole('link', { name: `${stamp}-in-group` }),
              ).toBeVisible({ timeout: 3000 });
            }).toPass({ timeout: 20_000 });

            // NEGATIVE: the public (non-group) page does not appear.
            await expect(
              list.getByRole('link', { name: `${stamp}-public` }),
            ).toHaveCount(0);
          } finally {
            await contextA.close();
          }
        });
      });

    test.describe
      .serial('prefix filter relevance', () => {
        // `prefix:<path>` matches pages whose path starts with <path>.
        const stamp = 'e2e-prefixfilter-4d7c1a';
        const targetPath = `/Sandbox/${stamp}-inc-target`;
        const controlPath = `/Sandbox/${stamp}-exc-control`;
        const created: CreatedPage[] = [];

        test.afterAll(async ({ request }) => {
          await deletePagesCompletely(request, created);
        });

        test('setup: create an in-prefix page and an out-of-prefix control page', async ({
          request,
        }) => {
          // Track each page as it is created (see tag setup).
          created.push(
            await createPage(request, {
              path: targetPath,
              body: `prefix filter ${stamp}`,
            }),
          );
          created.push(
            await createPage(request, {
              path: controlPath,
              body: `prefix filter ${stamp}`,
            }),
          );
        });

        test('prefix filter returns only pages under that path', async ({
          page,
          request,
        }) => {
          await rebuildSearchIndex(request);

          const list = page.getByTestId('search-result-list');

          // POSITIVE: the page under the prefix appears for `prefix:<path>`.
          await expect(async () => {
            await page.goto(`/_search?q=prefix:/Sandbox/${stamp}-inc`);
            await expect(page.getByTestId('search-result-base')).toBeVisible();
            await expect(
              list.getByRole('link', { name: `${stamp}-inc-target` }),
            ).toBeVisible({ timeout: 3000 });
          }).toPass({ timeout: 20_000 });

          // NEGATIVE: the page outside the prefix does not appear.
          await expect(
            list.getByRole('link', { name: `${stamp}-exc-control` }),
          ).toHaveCount(0);
        });
      });

    test.describe
      .serial('negated author filter relevance', () => {
        // Representative end-to-end check for negation (`-author:`). A bare `-author:`
        // matches every page except one, so scope it with a unique
        // `prefix:` to keep the result set deterministic.
        const stamp = 'e2e-notauthorfilter-8e2f0b';
        const prefix = `/Sandbox/${stamp}`;
        const byUserAPath = `${prefix}-by-a`;
        const byUserBPath = `${prefix}-by-b`;
        const created: CreatedPage[] = [];

        test.afterAll(async ({ request }) => {
          await deletePagesCompletely(request, created);
        });

        test('setup: create pages under one prefix authored by different users', async ({
          browser,
        }) => {
          const contextA = await browser.newContext({
            storageState: FILTER_TEST_USER_A.authFile,
          });
          const contextB = await browser.newContext({
            storageState: FILTER_TEST_USER_B.authFile,
          });
          try {
            // Track each page as it is created (see tag setup).
            created.push(
              await createPage(contextA.request, {
                path: byUserAPath,
                body: `not-author filter ${stamp}`,
              }),
            );
            created.push(
              await createPage(contextB.request, {
                path: byUserBPath,
                body: `not-author filter ${stamp}`,
              }),
            );
          } finally {
            await contextA.close();
            await contextB.close();
          }
        });

        test('negated author filter excludes that author within the scope', async ({
          page,
          request,
        }) => {
          await rebuildSearchIndex(request);

          const list = page.getByTestId('search-result-list');

          // POSITIVE: within the prefix scope, A's page is found.
          await expect(async () => {
            await page.goto(
              `/_search?q=prefix:${prefix} -author:${FILTER_TEST_USER_B.username}`,
            );
            await expect(page.getByTestId('search-result-base')).toBeVisible();
            await expect(
              list.getByRole('link', { name: `${stamp}-by-a` }),
            ).toBeVisible({ timeout: 3000 });
          }).toPass({ timeout: 20_000 });

          // NEGATIVE: B's page is excluded by -author:<B>.
          await expect(
            list.getByRole('link', { name: `${stamp}-by-b` }),
          ).toHaveCount(0);
        });
      });
  });
