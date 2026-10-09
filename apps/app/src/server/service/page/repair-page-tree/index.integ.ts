import type { IPage } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import { repairPageTree } from '.';
import { recountAllDescendantCounts } from './recount-all-descendant-counts';
import {
  deleteStillOrphanedEmptyPages,
  removeEmptyLeafHierarchies,
} from './remove-empty-leaf-hierarchies';

describe('repair-page-tree (integration)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let rootId: mongoose.Types.ObjectId;

  const base = '/test-repair-page-tree';

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    // The recount walks from each page's children; the root must exist.
    const root =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));
    // Fixtures link to it: a page with no parent is off-tree (an unnormalized v5
    // leftover), which the repair deliberately does not touch.
    rootId = root._id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Page.deleteMany({
      path: new RegExp(`^${escapeStringForMongoRegex(base)}`),
    });
  });

  describe('removeEmptyLeafHierarchies', () => {
    it('removes a childless empty page and cascades up to its now-empty parent', async () => {
      const baseId = new mongoose.Types.ObjectId();
      const midId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: baseId,
        path: base,
        parent: rootId,
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

      const removed = await removeEmptyLeafHierarchies();

      // mid is removed on the first pass; base becomes a childless leaf and is
      // removed on the second. A single-pass implementation would leave base.
      expect(await Page.findById(midId)).toBeNull();
      expect(await Page.findById(baseId)).toBeNull();
      expect(removed).toBeGreaterThanOrEqual(2);
    });

    it('keeps an empty page that still has a real child', async () => {
      const baseId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: baseId,
        path: base,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        path: `${base}/real`,
        parent: baseId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });

      await removeEmptyLeafHierarchies();

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
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        _id: realLeafId,
        path: `${base}/real-leaf`,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });

      await removeEmptyLeafHierarchies();

      expect(await Page.findById(emptyLeafId)).toBeNull();
      expect(await Page.findById(realLeafId)).not.toBeNull();
    });

    it('does not strand a later orphan when a candidate is declined mid-scan', async () => {
      // Regression guard: the scan used to advance a `$skip` past declined candidates,
      // which stepped over live orphans instead and stranded one per decline.
      //
      // Observing that takes a second batch plus a decline in the first. Rather than
      // insert 1001 fixtures, the real pipeline is narrowed to this subtree with a
      // batch of 2 — every stage deciding *which* pages are candidates, `$skip`
      // included, passes through untouched. Creating a child between the scan and the
      // delete is the only way to make the delete step decline.
      type Candidate = { _id: mongoose.Types.ObjectId };

      const orphanIds = [0, 1, 2].map(() => new mongoose.Types.ObjectId());
      await Page.insertMany(
        orphanIds.map((_id, i) => ({
          _id,
          path: `${base}/orphan-${i}`,
          parent: rootId,
          grant: Page.GRANT_PUBLIC,
          isEmpty: true,
        })),
      );

      // Captured before the spy replaces the method, so the real pipeline still runs.
      const realAggregate = Page.aggregate.bind(Page);
      let declinedId: mongoose.Types.ObjectId | undefined;

      const aggregateSpy = vi.spyOn(Page, 'aggregate').mockImplementation(((
        pipeline: mongoose.PipelineStage[],
      ) =>
        (async () => {
          const batch: Candidate[] = await realAggregate([
            {
              $match: {
                path: new RegExp(`^${escapeStringForMongoRegex(`${base}/`)}`),
              },
            },
            ...pipeline.map((stage) =>
              '$limit' in stage ? { $limit: 2 } : stage,
            ),
          ]);

          if (declinedId == null && batch.length > 0) {
            declinedId = batch[0]._id;
            await Page.create({
              path: `${base}/newborn`,
              parent: declinedId,
              grant: Page.GRANT_PUBLIC,
              isEmpty: false,
            });
          }

          return batch;
          // WHY the cast: aggregate() returns mongoose's Aggregate class, which an
          // async function cannot be. The code under test only awaits it, so a promise
          // behaves identically.
        })()) as unknown as typeof Page.aggregate);

      await removeEmptyLeafHierarchies();

      // Without these the test passes vacuously: no interleave means no decline, and
      // no decline means the stranding condition was never set up.
      expect(aggregateSpy).toHaveBeenCalled();
      expect(declinedId).toBeDefined();
      expect(await Page.findById(declinedId)).not.toBeNull();

      // Under the `$skip` bug the remaining orphan survived: it was the only page still
      // matching, and the offset of 1 skipped exactly it.
      const shouldBeGone = orphanIds.filter(
        (id) => String(id) !== String(declinedId),
      );
      expect(await Page.find({ _id: { $in: shouldBeGone } })).toHaveLength(0);
    });
  });

  describe('deleteStillOrphanedEmptyPages', () => {
    // The scan and the delete are two round trips against a possibly live site, so
    // candidates are a stale snapshot by construction — which is what these pass.

    it('spares a candidate that gained a child after it was scanned', async () => {
      // Deleting it dangles the new child's parent link, dropping it off the tree.
      const staleId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: staleId,
        path: `${base}/scanned-then-filled`,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      const snapshot = [{ _id: staleId, parent: rootId }];

      await Page.create({
        path: `${base}/scanned-then-filled/newborn`,
        parent: staleId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });

      const res = await deleteStillOrphanedEmptyPages(snapshot);

      expect(await Page.findById(staleId)).not.toBeNull();
      expect(res.removed).toBe(0);
    });

    it('spares a candidate that stopped being empty after it was scanned', async () => {
      // preparePageDocumentToCreate reuses an empty placeholder when a real page is
      // created at its path, so a candidate can have turned into content.
      const staleId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: staleId,
        path: `${base}/scanned-then-written`,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      const snapshot = [{ _id: staleId, parent: rootId }];

      await Page.updateOne({ _id: staleId }, { $set: { isEmpty: false } });

      const res = await deleteStillOrphanedEmptyPages(snapshot);

      expect(await Page.findById(staleId)).not.toBeNull();
      expect(res.removed).toBe(0);
    });

    it('deletes the still-orphaned candidates alongside the spared ones', async () => {
      // A stale entry must not stop the rest of the batch from being collected.
      const orphanId = new mongoose.Types.ObjectId();
      const staleId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: orphanId,
        path: `${base}/still-orphaned`,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        _id: staleId,
        path: `${base}/no-longer-orphaned`,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      await Page.create({
        path: `${base}/no-longer-orphaned/newborn`,
        parent: staleId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });

      const res = await deleteStillOrphanedEmptyPages([
        { _id: orphanId, parent: rootId },
        { _id: staleId, parent: rootId },
      ]);

      expect(await Page.findById(orphanId)).toBeNull();
      expect(await Page.findById(staleId)).not.toBeNull();
      expect(res.removed).toBe(1);
      // The parent is reported so the caller can check whether it, too, is now a
      // childless placeholder — that is how the cascade climbs.
      expect(res.parentIds.map(String)).toContain(String(rootId));
    });
  });

  describe('recountAllDescendantCounts', () => {
    it('repairs a descendantCount left inflated by a page deleted behind the app', async () => {
      const parentId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: parentId,
        path: base,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 5, // inflated, as if a TTL-deleted descendant were still counted
      });
      await Page.create({
        path: `${base}/child`,
        parent: parentId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 0,
      });

      await recountAllDescendantCounts(crowi.pageService);

      // One real child, whose own descendantCount is 0 → correct count is 1.
      expect((await Page.findById(parentId))?.descendantCount).toBe(1);
    });

    it('repairs inflated counts on every ancestor up the chain', async () => {
      // grandparent → parent → child, every ancestor inflated. The fix must
      // propagate bottom-up: each page is recounted from its children's
      // already-corrected counts, so a break in the DESC-path ordering would
      // leave the deeper ancestor wrong even when the direct parent is fixed.
      const grandparentId = new mongoose.Types.ObjectId();
      const parentId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: grandparentId,
        path: base,
        parent: rootId,
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

      await recountAllDescendantCounts(crowi.pageService);

      // child(0) → parent = 0 + 1 = 1 → grandparent = 1 + 1 = 2.
      expect((await Page.findById(parentId))?.descendantCount).toBe(1);
      expect((await Page.findById(grandparentId))?.descendantCount).toBe(2);
    });

    it('leaves an already-correct count untouched', async () => {
      // The recount skips no-op writes as an optimisation; the contract that must
      // survive is that a healthy tree comes out unchanged.
      const parentId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: parentId,
        path: base,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 1,
      });
      await Page.create({
        path: `${base}/child`,
        parent: parentId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 0,
      });

      await recountAllDescendantCounts(crowi.pageService);

      expect((await Page.findById(parentId))?.descendantCount).toBe(1);
    });

    it('leaves an off-tree page alone instead of zeroing its count', async () => {
      // A page left unnormalized by a partial v5 migration has no parent, and
      // neither do its children — so a recount from parent links finds nothing
      // under it and would flatten a count this repair has no business touching.
      const strayId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: strayId,
        path: base,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 3,
      });
      await Page.create({
        path: `${base}/v4-child`,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 0,
      });

      await recountAllDescendantCounts(crowi.pageService);

      expect((await Page.findById(strayId))?.descendantCount).toBe(3);
    });
  });

  describe('repairPageTree', () => {
    it('performs both halves of the repair in one call', async () => {
      // The composite contract: orphaned placeholders are gone AND inflated counts
      // are corrected. Dropping either half fails this test.
      //
      // Deliberately NOT an ordering assertion — a mutation check showed the two
      // steps commute, because recountDescendantCount excludes empty pages and the
      // recount is bottom-up. See the note on repairPageTree.
      const parentId = new mongoose.Types.ObjectId();
      const ghostId = new mongoose.Types.ObjectId();
      await Page.create({
        _id: parentId,
        path: base,
        parent: rootId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 4, // inflated
      });
      await Page.create({
        _id: ghostId,
        path: `${base}/ghost`,
        parent: parentId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true, // childless placeholder — an orphan
      });

      const summary = await repairPageTree(crowi.pageService);

      expect(await Page.findById(ghostId)).toBeNull();
      expect((await Page.findById(parentId))?.descendantCount).toBe(0);
      expect(summary.removedEmptyPages).toBeGreaterThanOrEqual(1);
    });
  });
});
