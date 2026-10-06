import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  trashPages,
} from '../utils/api';
import { openBacklinksPanel } from './open-backlinks-panel';

// B5.8 — E2E for the outgoing-link health section, covering Req 6.1 / 6.4.

// Fixed stamp so afterAll teardown keeps re-runs idempotent against the persistent e2e DB.
const stamp = 'e2e-link-health-3c9d40';
const trashedTargetPath = `/Sandbox/${stamp}-trashed-target`;
const sourcePath = `/Sandbox/${stamp}-source`;

test.describe
  .serial('Backlinks panel: outgoing link health', () => {
    const created: CreatedPage[] = [];

    test.beforeAll(async ({ request }) => {
      // Target before source: links resolve at extraction time, so a link to a
      // not-yet-existing page would be recorded as broken, not trashed.
      // Each page is recorded right after creation so a mid-setup failure still
      // gets cleaned up by afterAll.
      const target = await createPage(request, {
        path: trashedTargetPath,
        body: `link health target ${stamp}`,
      });
      created.push(target);
      const source = await createPage(request, {
        path: sourcePath,
        body: `link to [target](${trashedTargetPath})`,
      });
      created.push(source);

      // Extraction is async: trashing first could let it run after the target has
      // left its path, recording the link as broken instead of trashed. Wait until
      // the source shows up as a backlink of the target (the row exists), then trash.
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
          { message: 'source link was not extracted', timeout: 20_000 },
        )
        .toContain(source.pageId);

      // Teardown must poll the trashed path, not the pre-trash one.
      const [trashedTarget] = await trashPages(request, [target]);
      created[0] = trashedTarget;
    });

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, created);
    });

    test('flags a link to a trashed page as trashed, still linked (Req 6.1, 6.4)', async ({
      page,
    }) => {
      const section = page.getByTestId('backlinks-link-targets');
      const targetRow = section.getByRole('listitem').filter({
        hasText: `${stamp}-trashed-target`,
      });

      await expect(async () => {
        // Link rows and their target state are written asynchronously, so reload
        // each attempt to re-trigger the SWR fetch until the server catches up.
        await page.goto(sourcePath);
        await openBacklinksPanel(page);

        await expect(section).toBeVisible({ timeout: 3000 });
        await expect(targetRow).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // Trashed, not broken: the target still exists, so the badge says "In trash"
      // (backlinks.target_state.trashed, en_US) and never "Broken link".
      await expect(targetRow).toContainText('In trash');
      await expect(targetRow).not.toContainText('Broken link');
      // A trashed page still exists, so its row stays a link (a broken row has no
      // pageId and renders as plain text).
      await expect(
        targetRow.getByRole('link', {
          name: new RegExp(`${stamp}-trashed-target`),
        }),
      ).toBeVisible();
    });
  });
