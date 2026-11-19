import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  trashPages,
} from '../utils/api';
import { openBacklinksPanel } from './open-backlinks-panel';

// B5.8 — E2E for the outgoing-link health section, covering Req 6.1 / 6.2 / 6.4.

// Fixed stamp so afterAll teardown keeps re-runs idempotent against the persistent e2e DB.
const stamp = 'e2e-link-health-3c9d40';
const trashedTargetName = `${stamp}-trashed-target`;
const deletedTargetName = `${stamp}-deleted-target`;
const healthyTargetName = `${stamp}-healthy-target`;
const trashedTargetPath = `/Sandbox/${trashedTargetName}`;
const deletedTargetPath = `/Sandbox/${deletedTargetName}`;
const healthyTargetPath = `/Sandbox/${healthyTargetName}`;
const sourcePath = `/Sandbox/${stamp}-source`;

// Link rows are extracted asynchronously after the source is saved. Wait until the
// source is listed as a backlink of the target, which means its link row exists.
const waitForLinkExtracted = async (
  request: APIRequestContext,
  target: CreatedPage,
  source: CreatedPage,
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const res = await request.get('/_api/v3/page/backlinks', {
          params: { pageId: target.pageId },
        });
        if (!res.ok()) return [];
        const { backlinks } = await res.json();
        return backlinks.map((b: { pageId: string }) => b.pageId);
      },
      {
        message: `source link to ${target.path} was not extracted`,
        timeout: 20_000,
      },
    )
    .toContain(source.pageId);
};

// Link rows and their target state are written asynchronously, so reload each
// attempt to re-trigger the SWR fetch until `awaitedRowName` shows up in the section.
const openLinkHealthSection = async (
  page: Page,
  awaitedRowName: string,
): Promise<Locator> => {
  const section = page.getByTestId('backlinks-link-targets');

  await expect(async () => {
    await page.goto(sourcePath);
    await openBacklinksPanel(page);

    await expect(section).toBeVisible({ timeout: 3000 });
    await expect(
      section.getByRole('listitem').filter({ hasText: awaitedRowName }),
    ).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });

  return section;
};

test.describe
  .serial('Backlinks panel: outgoing link health', () => {
    let created: CreatedPage[] = [];

    test.beforeAll(async ({ request }) => {
      // Targets before source: links resolve at extraction time, so a link to a
      // not-yet-existing page would be recorded as broken from the start, letting
      // the deleted-target test pass without ever exercising the delete path.
      // Each page is recorded right after creation so a mid-setup failure still
      // gets cleaned up by afterAll.
      const trashedTarget = await createPage(request, {
        path: trashedTargetPath,
        body: `link health target ${stamp}`,
      });
      created.push(trashedTarget);
      const deletedTarget = await createPage(request, {
        path: deletedTargetPath,
        body: `link health target ${stamp}`,
      });
      created.push(deletedTarget);
      const healthyTarget = await createPage(request, {
        path: healthyTargetPath,
        body: `link health target ${stamp}`,
      });
      created.push(healthyTarget);

      const source = await createPage(request, {
        path: sourcePath,
        body: [
          `link to [trashed](${trashedTargetPath})`,
          `link to [deleted](${deletedTargetPath})`,
          `link to [healthy](${healthyTargetPath})`,
        ].join('\n\n'),
      });
      created.push(source);

      // Extraction is async: trashing or deleting first could let it run after the
      // target has left its path, recording the link as broken instead of trashed
      // (and making the broken assertion vacuous). Wait for every link row first.
      await waitForLinkExtracted(request, trashedTarget, source);
      await waitForLinkExtracted(request, deletedTarget, source);
      await waitForLinkExtracted(request, healthyTarget, source);

      // Teardown must poll the trashed path, not the pre-trash one.
      const [trashedTargetInTrash] = await trashPages(request, [trashedTarget]);
      created = created.map((p) =>
        p.pageId === trashedTarget.pageId ? trashedTargetInTrash : p,
      );

      // Already gone once this resolves, so teardown must not delete it again.
      await deletePagesCompletely(request, [deletedTarget]);
      created = created.filter((p) => p.pageId !== deletedTarget.pageId);
    });

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, created);
    });

    test('flags a link to a trashed page as trashed, still linked (Req 6.1, 6.4)', async ({
      page,
    }) => {
      const section = await openLinkHealthSection(page, trashedTargetName);
      const targetRow = section.getByRole('listitem').filter({
        hasText: trashedTargetName,
      });

      // Trashed, not broken: the target still exists, so the badge says "In trash"
      // (backlinks.target_state.trashed, en_US) and never "Broken link".
      await expect(targetRow).toContainText('In trash');
      await expect(targetRow).not.toContainText('Broken link');
      // A trashed page still exists, so its row stays a link (a broken row has no
      // pageId and renders as plain text).
      await expect(
        targetRow.getByRole('link', { name: new RegExp(trashedTargetName) }),
      ).toBeVisible();
    });

    test('flags a link to a deleted page as broken (Req 6.2)', async ({
      page,
    }) => {
      const section = await openLinkHealthSection(page, deletedTargetName);
      const targetRow = section.getByRole('listitem').filter({
        hasText: deletedTargetName,
      });

      // Broken, not trashed: the target is gone, so the badge says "Broken link"
      // (backlinks.target_state.broken, en_US) and never "In trash".
      await expect(targetRow).toContainText('Broken link');
      await expect(targetRow).not.toContainText('In trash');
      // Nothing to navigate to: the row keeps the path as plain text, unlinked.
      await expect(targetRow.getByRole('link')).toHaveCount(0);
    });

    test('does not list a link to a healthy page in the needs-attention section', async ({
      page,
    }) => {
      // Wait on a row that must be present, so the absence check below runs against
      // a fully loaded section instead of passing before the fetch lands.
      const section = await openLinkHealthSection(page, trashedTargetName);

      await expect(
        section.getByRole('listitem').filter({ hasText: healthyTargetName }),
      ).toHaveCount(0);
    });
  });
