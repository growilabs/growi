/**
 * Memory of the GROWI process while duplicating a page with its descendants
 * (design.md Testing Strategy > Performance, requirement 2.1-2.3).
 *
 * Runs the real `crowi.pageService.duplicate(..., isRecursively=true)` and
 * waits for the background run to finish (its PageOperation is deleted). It
 * uses no API added by the page-duplicate spec, so the same file measures the
 * commit before the spec as well.
 *
 * Scenarios (PERF_SCENARIO), one per process:
 *   - flat-15mb  : 100 descendants, one revision each, body 15,000,000 bytes
 *   - flat-1kb   : 100 descendants, one revision each, body 1,024 bytes
 *   - prod-shape : 83 descendants, 1505 revisions, body 38,000 bytes (~57 MB)
 *
 * Run from apps/app (no MONGO_URI, so MongoMemoryServer is used):
 *   env -u MONGO_URI PERF_SCENARIO=flat-1kb ../../node_modules/.bin/vitest run \
 *     --config tools/page-duplicate-perf/vitest.config.mts duplicate-memory
 *
 * The result is printed as one line starting with `PERF_RESULT `.
 */
import { ConfigSource } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';

import {
  BASE_PATH,
  deleteCopy,
  findChildMongodPids,
  forceGc,
  inspectCopy,
  readProcMemory,
  resetPeak,
  type SeededTree,
  seedTree,
  sleep,
  startSampler,
  type TreeShape,
  toMiB,
  waitUntilOperationGone,
} from './perf-fixtures';

const SCENARIOS: Record<string, TreeShape> = {
  'flat-15mb': {
    descendantCount: 100,
    childCount: 100,
    revisionCount: 100,
    bodyBytes: 15_000_000,
  },
  'flat-1kb': {
    descendantCount: 100,
    childCount: 100,
    revisionCount: 100,
    bodyBytes: 1024,
  },
  'prod-shape': {
    descendantCount: 83,
    childCount: 8,
    revisionCount: 1505,
    bodyBytes: 38_000,
  },
};

const WARM_UP_SHAPE: TreeShape = {
  descendantCount: 3,
  childCount: 3,
  revisionCount: 3,
  bodyBytes: 1024,
};

const scenarioName = process.env.PERF_SCENARIO ?? '';
const repeat = Number(process.env.PERF_REPEAT ?? '1');

describe('page duplicate memory', () => {
  let crowi: Crowi;
  let unhandledRejections = 0;
  const onUnhandled = () => {
    unhandledRejections += 1;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    process.on('unhandledRejection', onUnhandled);
  });

  afterAll(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  const duplicateAndWait = async (seeded: SeededTree, newPagePath: string) => {
    await crowi.pageService.duplicate(
      seeded.source,
      newPagePath,
      seeded.user,
      true,
      false,
    );
    await waitUntilOperationGone(seeded.source.path);
  };

  it(`measures ${scenarioName}`, async () => {
    const shape = SCENARIOS[scenarioName];
    if (shape == null) {
      throw new Error(
        `Set PERF_SCENARIO to one of: ${Object.keys(SCENARIOS).join(', ')}`,
      );
    }
    expect(
      crowi.configManager.getConfig('app:isV5Compatible', ConfigSource.db),
    ).toBe(true);

    // Warm up lazily loaded modules and JIT with a tiny tree, then discard it.
    const warmUp = await seedTree(WARM_UP_SHAPE, 'perfwarmup');
    await duplicateAndWait(warmUp, `${BASE_PATH}/warm-up-copy`);
    await deleteCopy(`${BASE_PATH}/warm-up-copy`);
    await deleteCopy(BASE_PATH);
    await mongoose.model('User').deleteMany({ username: 'perfwarmup' });

    const seeded = await seedTree(shape, 'perfuser');
    const mongodPids = findChildMongodPids();

    for (let run = 1; run <= repeat; run++) {
      const newPagePath = `${BASE_PATH}/copy-r${run}`;
      forceGc();
      // biome-ignore lint/performance/noAwaitInLoops: one measured run at a time
      await sleep(500);
      forceGc();
      resetPeak();
      for (const pid of mongodPids) {
        resetPeak(pid);
      }
      const baseline = readProcMemory();
      const baselineUsage = process.memoryUsage();
      const mongodBaseline = mongodPids.map((pid) => readProcMemory(pid).rss);
      const sampler = startSampler(20);

      const startedAt = performance.now();
      await duplicateAndWait(seeded, newPagePath);
      const durationMs = Math.round(performance.now() - startedAt);

      const peakUsage = sampler.stop();
      const after = readProcMemory();
      const mongodPeak = mongodPids.map((pid) => readProcMemory(pid).hwm);
      const copy = await inspectCopy(newPagePath);

      const result = {
        scenario: scenarioName,
        run,
        shape,
        durationMs,
        baselineRssMiB: toMiB(baseline.rss),
        peakRssMiB: toMiB(after.hwm),
        peakRssIncreaseMiB: toMiB(after.hwm - baseline.rss),
        sampledPeakRssIncreaseMiB: toMiB(peakUsage.rss - baselineUsage.rss),
        heapUsedIncreaseMiB: toMiB(peakUsage.heapUsed - baselineUsage.heapUsed),
        externalIncreaseMiB: toMiB(peakUsage.external - baselineUsage.external),
        arrayBuffersIncreaseMiB: toMiB(
          peakUsage.arrayBuffers - baselineUsage.arrayBuffers,
        ),
        mongodBaselineRssMiB: mongodBaseline.map(toMiB),
        mongodPeakRssMiB: mongodPeak.map(toMiB),
        copy,
        unhandledRejections,
      };
      // biome-ignore lint/suspicious/noConsole: the measurement result
      console.log(`PERF_RESULT ${JSON.stringify(result)}`);

      expect(copy.copiedNonEmptyPages).toBe(shape.descendantCount);
      expect(copy.copiedRevisionCount).toBe(shape.descendantCount);
      expect(copy.copiesWithoutParent).toBe(0);
      expect(copy.topDescendantCount).toBe(shape.descendantCount);
      expect(copy.copiedBodyMinBytes).toBe(shape.bodyBytes);
      expect(copy.copiedBodyMaxBytes).toBe(shape.bodyBytes);
      expect(unhandledRejections).toBe(0);

      await deleteCopy(newPagePath);
    }
  });
});
