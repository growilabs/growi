import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SPEC_TMP_PREFIX } from '../../test/fixtures';
import { MAX_CHILD_HEADER_BYTES } from '../wire/child-header';
import { createConversionRunner, type RunInput } from './conversion-runner';
import {
  childPids,
  killStrayChildren,
  runnerOptions,
  STAND_IN_CHILD,
  standInInput,
  within,
} from './spec-support';

// research.md 27.5: a file name or MIME hint the client sent can make the
// child's header frame larger than the child accepts. That is the client's
// input being too large (422), not a crash (500), and no child is started.
// The stand-in would answer success for anything and writes its pid to the
// trace file first, so a missing trace proves no child ran.

const OVERSIZE = 'x'.repeat(MAX_CHILD_HEADER_BYTES);

describe.skipIf(process.platform !== 'linux')(
  'a run whose header is over the frame ceiling',
  () => {
    let traceDir = '';

    beforeAll(async () => {
      traceDir = await mkdtemp(
        path.join(tmpdir(), `${SPEC_TMP_PREFIX}header-`),
      );
    });

    afterAll(async () => {
      await rm(traceDir, { recursive: true, force: true });
    });

    afterEach(killStrayChildren);

    it.each<[string, (trace: string) => RunInput]>([
      [
        'file name',
        (trace) => standInInput('echo', { trace, fileName: `${OVERSIZE}.bin` }),
      ],
      [
        'MIME hint',
        (trace) => standInInput('echo', { trace, mimeHint: OVERSIZE }),
      ],
    ])('answers limit_exceeded for an oversize %s without starting a child', async (field, inputWith) => {
      const trace = path.join(traceDir, `${field.replace(' ', '-')}.pid`);
      const runner = createConversionRunner(
        runnerOptions({ childEntry: STAND_IN_CHILD }),
      );

      const outcome = await within(
        runner.run(inputWith(trace), new AbortController().signal),
      );

      expect(outcome).toMatchObject({
        kind: 'failed',
        failure: 'limit_exceeded',
        childPeakRssMb: null,
      });
      expect(existsSync(trace)).toBe(false);
      expect(childPids()).toEqual([]);
    });
  },
);
