import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_TMP_PREFIX } from '../../test/fixtures/tmp-prefix';
import { createConversionRunner } from './conversion-runner';
import {
  childPids,
  hasEnded,
  killStrayChildren,
  MISSING_CHILD,
  manualClock,
  runnerOptions,
  SILENT_CHILD,
  waitForOnlyChild,
  waitUntil,
  within,
} from './spec-support';

// design.md: ready means prlimit can be started and a probe child,
// started the same way as a conversion child (prlimit, childEntry), loads every
// conversion component and answers. Python test_forkserver.py: the five cases
// 22.3 carries over (ready with everything loaded, not ready when a component
// cannot load, a frozen probe still answers within its time limit). /readyz's
// response shape is the HTTP layer's (4.4); only `ready` is checked here.

const PROBE_TIMEOUT_S = 1;
// Margin for killing the stuck probe and reaping it.
const RETURN_MARGIN_MS = 3_000;

describe.skipIf(process.platform !== 'linux')(
  'ConversionRunner.readiness',
  () => {
    afterEach(killStrayChildren);

    it('is ready with prlimit and the real child entry', async () => {
      const runner = createConversionRunner(runnerOptions());

      const readiness = await within(runner.readiness());

      expect(readiness.ready).toBe(true);
    });

    it.each([
      ['is missing', '/nonexistent/prlimit'],
      ['is not executable', fileURLToPath(import.meta.url)],
      ['is a directory', '/usr/bin'],
    ])('is not ready when prlimit %s', async (_case, prlimitPath) => {
      const runner = createConversionRunner(runnerOptions({ prlimitPath }));

      const readiness = await within(runner.readiness());

      expect(readiness.ready).toBe(false);
    });

    it('is not ready when the probe child cannot load its entry', async () => {
      const runner = createConversionRunner(
        runnerOptions({ childEntry: MISSING_CHILD }),
      );

      expect((await within(runner.readiness())).ready).toBe(false);
    });

    it('answers not ready within its time limit when the probe child never answers', async () => {
      const runner = createConversionRunner(
        runnerOptions({
          childEntry: SILENT_CHILD,
          probeTimeoutS: PROBE_TIMEOUT_S,
        }),
      );
      const began = Date.now();

      const checking = within(runner.readiness());
      // The probe is a real child started the same way as a conversion child.
      const probePid = await waitForOnlyChild(5_000);
      const readiness = await checking;

      expect(readiness.ready).toBe(false);
      expect(hasEnded(probePid)).toBe(true);
      expect(Date.now() - began).toBeLessThan(
        PROBE_TIMEOUT_S * 1000 + RETURN_MARGIN_MS,
      );
      // The stuck probe is stopped and reaped, not left behind.
      expect(await waitUntil(() => childPids().length === 0, 2_000)).toBe(true);
    });

    describe('a settled check', () => {
      let workDir = '';

      beforeEach(() => {
        workDir = mkdtempSync(path.join(tmpdir(), `${SPEC_TMP_PREFIX}ready-`));
      });

      afterEach(() => {
        rmSync(workDir, { recursive: true, force: true });
      });

      it('is answered for 10 s after it settled, then checked again', async () => {
        const prlimitPath = path.join(workDir, 'prlimit');
        const clock = manualClock();
        const runner = createConversionRunner(
          runnerOptions({ prlimitPath, readinessClock: clock.now }),
        );
        expect((await within(runner.readiness())).ready).toBe(false);

        symlinkSync('/usr/bin/prlimit', prlimitPath);
        clock.advance(10_000);
        const kept = await within(runner.readiness());
        clock.advance(1);
        const checkedAgain = await within(runner.readiness());

        expect(kept.ready).toBe(false);
        expect(checkedAgain.ready).toBe(true);
      });
    });
  },
);
