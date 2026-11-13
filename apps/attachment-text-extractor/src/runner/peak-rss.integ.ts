import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createConversionRunner } from './conversion-runner';
import {
  killStrayChildren,
  runnerOptions,
  standInInput,
  within,
} from './spec-support';

// research.md 23.5 / 20.12: childPeakRssMb is the child's peak, VmHWM
// included, not only the VmRSS values a 50 ms poll happened to see. The child
// here spikes and frees its memory well before it answers, so only its
// high-water mark still shows the spike.

const here = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_SPIKE_CHILD = {
  path: path.join(here, 'spec-support', 'memory-spike-child.mjs'),
  nodeArgs: ['--expose-gc'],
};

interface SpikeReport {
  readonly spikeMib: number;
  readonly rssAtAnswerKib: number;
  readonly hwmAtAnswerKib: number;
}

const isSpikeReport = (value: unknown): value is SpikeReport =>
  typeof value === 'object' &&
  value !== null &&
  'spikeMib' in value &&
  typeof value.spikeMib === 'number' &&
  'rssAtAnswerKib' in value &&
  typeof value.rssAtAnswerKib === 'number' &&
  'hwmAtAnswerKib' in value &&
  typeof value.hwmAtAnswerKib === 'number';

describe.skipIf(process.platform !== 'linux')(
  'the reported child peak RSS',
  () => {
    afterEach(killStrayChildren);

    it('includes a spike that was over before the result came', async () => {
      const runner = createConversionRunner(
        runnerOptions({ childEntry: MEMORY_SPIKE_CHILD, maxChildRssMb: 2000 }),
      );

      const outcome = await within(
        runner.run(standInInput('spike'), new AbortController().signal),
      );

      if (outcome.kind !== 'ok') {
        throw new Error(`the child failed: ${JSON.stringify(outcome)}`);
      }
      const report: unknown = JSON.parse(outcome.pages[0]?.content ?? 'null');
      if (!isSpikeReport(report)) {
        throw new Error('the child sent no spike report');
      }
      // The memory really was given back: VmRSS alone would not show the spike.
      expect(report.rssAtAnswerKib / 1024).toBeLessThan(report.spikeMib / 2);
      // A poll that lands while the spike is still being filled sees less
      // than its top; only the high-water mark itself reaches it.
      expect((outcome.childPeakRssMb ?? 0) * 1024).toBeGreaterThanOrEqual(
        report.hwmAtAnswerKib,
      );
    });
  },
);
