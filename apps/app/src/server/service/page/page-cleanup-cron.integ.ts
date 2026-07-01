import type { IPage } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import { PageCleanupCronService } from './page-cleanup-cron';

describe('PageCleanupCronService (integration)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let cron: PageCleanupCronService;

  const base = '/test-page-cleanup-cron';

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');
    cron = new PageCleanupCronService(crowi);

    // Some recount internals assume the root page exists.
    const root = await Page.findOne({ path: '/' });
    if (root == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
  });

  afterEach(async () => {
    await Page.deleteMany({
      path: new RegExp(`^${escapeStringForMongoRegex(base)}`),
    });
  });

  describe('recountAndUpdateDescendantCountOfAllPages', () => {
    it('repairs a descendantCount left inflated by a TTL-deleted WIP page', async () => {
      const parentId = new mongoose.Types.ObjectId();
      // Inflated, as if a TTL-deleted WIP descendant were still counted.
      await Page.create({
        _id: parentId,
        path: base,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 5,
      });
      await Page.create({
        path: `${base}/child`,
        parent: parentId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 0,
      });

      await crowi.pageService.recountAndUpdateDescendantCountOfAllPages();

      const parent = await Page.findById(parentId);
      // One real child, whose own descendantCount is 0 → correct count is 1.
      expect(parent?.descendantCount).toBe(1);
    });

    it('repairs inflated counts on every ancestor up the chain', async () => {
      // grandparent → parent → child, every ancestor inflated. The fix must
      // propagate bottom-up: each page is recounted from its children's
      // already-corrected counts, so a break in the DESC-path ordering would
      // leave a deeper ancestor wrong even if the direct parent is fixed.
      const grandparentId = new mongoose.Types.ObjectId();
      const parentId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: grandparentId,
        path: base,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 9,
      });
      await Page.create({
        _id: parentId,
        path: `${base}/parent`,
        parent: grandparentId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 7,
      });
      await Page.create({
        path: `${base}/parent/child`,
        parent: parentId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 0,
      });

      await crowi.pageService.recountAndUpdateDescendantCountOfAllPages();

      // child(0) → parent = 0 + 1 = 1 → grandparent = 1 + 1 = 2.
      const grandparent = await Page.findById(grandparentId);
      const parent = await Page.findById(parentId);
      expect(parent?.descendantCount).toBe(1);
      expect(grandparent?.descendantCount).toBe(2);
    });
  });

  describe('removeEmptyLeafHierarchies', () => {
    it('removes a childless empty page and cascades up to its now-empty parent', async () => {
      const baseId = new mongoose.Types.ObjectId();
      const midId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: baseId,
        path: base,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        _id: midId,
        path: `${base}/mid`,
        parent: baseId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });

      await cron.removeEmptyLeafHierarchies();

      // mid is removed on the first pass; base becomes a childless leaf and is
      // removed on the second pass.
      expect(await Page.findById(midId)).toBeNull();
      expect(await Page.findById(baseId)).toBeNull();
    });

    it('keeps an empty page that still has a real child', async () => {
      const baseId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: baseId,
        path: base,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        path: `${base}/real`,
        parent: baseId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });

      await cron.removeEmptyLeafHierarchies();

      expect(await Page.findById(baseId)).not.toBeNull();
    });

    it('deletes a childless empty page but keeps a childless real page', async () => {
      // Guards the isEmpty filter: only empty placeholders are orphans. A real
      // page with no children is legitimate content and must never be removed.
      const emptyLeafId = new mongoose.Types.ObjectId();
      const realLeafId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: emptyLeafId,
        path: `${base}/empty-leaf`,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        _id: realLeafId,
        path: `${base}/real-leaf`,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });

      await cron.removeEmptyLeafHierarchies();

      expect(await Page.findById(emptyLeafId)).toBeNull();
      expect(await Page.findById(realLeafId)).not.toBeNull();
    });
  });
});
