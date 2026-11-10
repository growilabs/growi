import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createConversionRunner } from './conversion-runner';
import {
  childPids,
  killStrayChildren,
  processState,
  runnerOptions,
  SILENT_CHILD,
  within,
} from './spec-support';

// Req 8.8: what a probe answer must contain, and how many probe children may
// run at once. /readyz needs no token, so its callers must not be able to
// start probe children without bound.

const here = path.dirname(fileURLToPath(import.meta.url));
const UNRELATED_ANSWER_CHILD = {
  path: path.join(here, 'spec-support', 'unrelated-answer-child.mjs'),
  nodeArgs: [],
};
const CALLERS = 10;
const PROBE_TIMEOUT_S = 1;

describe.skipIf(process.platform !== 'linux')(
  'the readiness probe',
  { timeout: 30_000 },
  () => {
    afterEach(killStrayChildren);

    it('is not ready when the probe child answers success without the probe text', async () => {
      const runner = createConversionRunner(
        runnerOptions({ childEntry: UNRELATED_ANSWER_CHILD }),
      );

      expect((await within(runner.readiness())).ready).toBe(false);
    });

    it('runs one probe child at a time however many callers ask at once', async () => {
      const runner = createConversionRunner(
        runnerOptions({
          childEntry: SILENT_CHILD,
          probeTimeoutS: PROBE_TIMEOUT_S,
        }),
      );
      let mostAlive = 0;
      const watch = setInterval(() => {
        const alive = childPids().filter(
          (pid) => processState(pid) === 'alive',
        );
        mostAlive = Math.max(mostAlive, alive.length);
      }, 5);

      try {
        const answers = await within(
          Promise.all(
            Array.from({ length: CALLERS }, () => runner.readiness()),
          ),
        );
        expect(answers.map((answer) => answer.ready)).toEqual(
          Array.from({ length: CALLERS }, () => false),
        );
      } finally {
        clearInterval(watch);
      }

      // Without sharing, all ten would hold a silent child for the whole second.
      expect(mostAlive).toBe(1);
    });
  },
);
