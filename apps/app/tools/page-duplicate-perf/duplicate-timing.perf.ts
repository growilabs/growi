/**
 * Durations of the page-duplicate writes and of the recovery
 * (design.md Testing Strategy > Performance, requirement 4.2 and 4.4).
 * Uses the duplicate module, so it runs only on commits that have it.
 *
 * Scenarios (PERF_SCENARIO), one per process:
 *   - merge-chunk : 100 revisions of 15,000,000 bytes; times copyCurrentRevisions
 *                   with 10 entries (one $merge of REVISION_MERGE_CHUNK_SIZE), 10 times
 *   - recovery    : a copy of 83 descendants (8 children, 75 grandchildren),
 *                   orphaned as if the run had stopped after copying every page;
 *                   times one run of the recovery cron (take-over, sub operation,
 *                   PageOperation deletion, notification) and the sub operation
 *                   alone. Revisions default to 1505 of 38,000 bytes (as prod-shape).
 *                   PERF_DESCENDANTS / PERF_CHILDREN / PERF_REVISIONS /
 *                   PERF_BODY_BYTES change the tree, PERF_REPEAT the number of
 *                   repetitions (default 5).
 *
 * Run from apps/app (no MONGO_URI, so MongoMemoryServer is used):
 *   env -u MONGO_URI PERF_SCENARIO=recovery ../../node_modules/.bin/vitest run \
 *     --config tools/page-duplicate-perf/vitest.config.mts duplicate-timing
 *
 * The result is printed as one line starting with `PERF_RESULT `.
 */
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import {
  copyCurrentRevisions,
  MERGE_MAX_TIME_MS,
  REVISION_MERGE_CHUNK_SIZE,
} from '~/server/service/page/duplicate/copy-current-revisions';
import {
  createDuplicatePageOperation,
  STALL_THRESHOLD_MS,
} from '~/server/service/page/duplicate/duplicate-page-operation';
import {
  InterruptedDuplicateRecoveryCronService,
  RECOVERY_JITTER_MS,
} from '~/server/service/page/duplicate/interrupted-duplicate-recovery-cron';
import { runDuplicateSubOperation } from '~/server/service/page/duplicate/run-duplicate-sub-operation';

import {
  BASE_PATH,
  deleteCopy,
  inspectCopy,
  seedTree,
  type TreeShape,
  waitUntilOperationGone,
} from './perf-fixtures';

const CRON_INTERVAL_MS = 60 * 1000;
const scenarioName = process.env.PERF_SCENARIO ?? '';

const summarize = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    values,
    min: sorted[0],
    median: sorted[Math.floor((sorted.length - 1) / 2)],
    avg: Math.round(sum / sorted.length),
    max: sorted[sorted.length - 1],
  };
};

describe('page duplicate timing', () => {
  let crowi: Crowi;
  let Page: PageModel;

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
  });

  const runIf = (name: string) => (scenarioName === name ? it : it.skip);

  runIf('merge-chunk')(
    'times one $merge of 10 revisions of 15 MB',
    async () => {
      const shape: TreeShape = {
        descendantCount: 100,
        childCount: 100,
        revisionCount: 100,
        bodyBytes: 15_000_000,
      };
      const seeded = await seedTree(shape, 'perfuser');
      const sourcePages = await Page.find(
        { path: { $in: [...seeded.descendantPaths] } },
        { _id: 1, revision: 1 },
      ).lean();
      expect(sourcePages).toHaveLength(100);

      const durations: number[] = [];
      for (let i = 0; i < sourcePages.length; i += REVISION_MERGE_CHUNK_SIZE) {
        const entries = sourcePages
          .slice(i, i + REVISION_MERGE_CHUNK_SIZE)
          .map((p) => ({
            sourceRevisionId: String(p.revision),
            newRevisionId: new Types.ObjectId().toHexString(),
            newPageId: new Types.ObjectId().toHexString(),
          }));
        const startedAt = performance.now();
        // biome-ignore lint/performance/noAwaitInLoops: one $merge at a time, as in the duplicate
        const { copiedRevisionIds } = await copyCurrentRevisions(
          entries,
          String(seeded.user._id),
          async () => {},
        );
        durations.push(Math.round(performance.now() - startedAt));
        expect(copiedRevisionIds.size).toBe(REVISION_MERGE_CHUNK_SIZE);
        await mongoose.connection.collection('revisions').deleteMany({
          _id: { $in: entries.map((e) => new Types.ObjectId(e.newRevisionId)) },
        });
      }

      const result = {
        scenario: scenarioName,
        chunkSize: REVISION_MERGE_CHUNK_SIZE,
        bodyBytes: shape.bodyBytes,
        mergeMaxTimeMs: MERGE_MAX_TIME_MS,
        chunkDurationMs: summarize(durations),
      };
      // biome-ignore lint/suspicious/noConsole: the measurement result
      console.log(`PERF_RESULT ${JSON.stringify(result)}`);
      expect(Math.max(...durations)).toBeLessThan(MERGE_MAX_TIME_MS);
    },
  );

  runIf('recovery')('times the recovery of an orphaned copy', async () => {
    const descendantCount = Number(process.env.PERF_DESCENDANTS ?? '83');
    const shape: TreeShape = {
      descendantCount,
      childCount: Number(process.env.PERF_CHILDREN ?? '8'),
      revisionCount: Math.max(
        descendantCount,
        Number(process.env.PERF_REVISIONS ?? '1505'),
      ),
      bodyBytes: Number(process.env.PERF_BODY_BYTES ?? '38000'),
    };
    const repeat = Number(process.env.PERF_REPEAT ?? '5');
    const seeded = await seedTree(shape, 'perfuser');
    const userId = String(seeded.user._id);
    const notifications = mongoose.connection.collection('inappnotifications');

    const orphanCopy = async (newPagePath: string) => {
      const copyFilter = {
        path: new RegExp(`^${escapeStringForMongoRegex(newPagePath)}/`),
      };
      await Page.updateMany(copyFilter, {
        $set: { parent: null, descendantCount: 0 },
      });
      await Page.updateOne(
        { path: newPagePath },
        { $set: { descendantCount: 0 } },
      );
      const orphaned = await inspectCopy(newPagePath);
      expect(orphaned.copiesWithoutParent).toBe(descendantCount);
    };

    const expectRecovered = async (newPagePath: string) => {
      const copy = await inspectCopy(newPagePath);
      expect(copy.copiedNonEmptyPages).toBe(descendantCount);
      expect(copy.copiesWithoutParent).toBe(0);
      expect(copy.topDescendantCount).toBe(descendantCount);
    };

    const cronRunMs: number[] = [];
    const subOperationMs: number[] = [];
    for (let run = 1; run <= repeat; run++) {
      const newPagePath = `${BASE_PATH}/copy-r${run}`;
      // biome-ignore lint/performance/noAwaitInLoops: one measured run at a time
      await crowi.pageService.duplicate(
        seeded.source,
        newPagePath,
        seeded.user,
        true,
        false,
      );
      await waitUntilOperationGone(seeded.source.path);
      await expectRecovered(newPagePath);

      // (1) the cron: take over the stalled PageOperation and recover it
      await orphanCopy(newPagePath);
      const operation = await createDuplicatePageOperation({
        page: seeded.source,
        userId,
        fromPath: seeded.source.path,
        toPath: newPagePath,
      });
      await PageOperation.updateOne(
        { _id: operation.operationId },
        {
          $set: {
            lastProgressAt: new Date(Date.now() - STALL_THRESHOLD_MS - 1000),
          },
        },
      );
      const notificationsBefore = await notifications.countDocuments({});
      const cron = new InterruptedDuplicateRecoveryCronService({
        duplicateDeps: crowi.pageService.duplicateDeps(),
        appService: { isMaintenanceMode: () => false },
        waitBeforeRun: async () => {},
      });
      const cronStartedAt = performance.now();
      await cron.executeJob();
      cronRunMs.push(Math.round(performance.now() - cronStartedAt));
      expect(
        await PageOperation.countDocuments({
          actionType: PageActionType.Duplicate,
        }),
      ).toBe(0);
      // the notification is written by an event listener after the run returns
      await vi.waitFor(
        async () => {
          expect(await notifications.countDocuments({})).toBe(
            notificationsBefore + 1,
          );
        },
        { timeout: 10_000, interval: 50 },
      );
      await expectRecovered(newPagePath);

      // (2) the sub operation alone, on the same copy orphaned again
      await orphanCopy(newPagePath);
      const subStartedAt = performance.now();
      const { copiedPageCount } = await runDuplicateSubOperation(
        crowi.pageService.duplicateDeps(),
        {
          toPath: newPagePath,
          userId,
          shouldNormalizeParent: true,
          ancestorUpdate: { kind: 'recount' },
          onBatchStart: async () => {},
        },
      );
      subOperationMs.push(Math.round(performance.now() - subStartedAt));
      expect(copiedPageCount).toBe(descendantCount + 1);
      await expectRecovered(newPagePath);

      await deleteCopy(newPagePath);
    }

    const worstCaseStartMs =
      STALL_THRESHOLD_MS + CRON_INTERVAL_MS + RECOVERY_JITTER_MS;
    const cronSummary = summarize(cronRunMs);
    const result = {
      scenario: scenarioName,
      shape,
      cronRunMs: cronSummary,
      subOperationMs: summarize(subOperationMs),
      worstCaseStartMs,
      worstCaseRecoveredMs: worstCaseStartMs + cronSummary.max,
    };
    // biome-ignore lint/suspicious/noConsole: the measurement result
    console.log(`PERF_RESULT ${JSON.stringify(result)}`);
  });
});
