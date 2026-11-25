// Touches SPIKE_MIB of memory, frees it at once, waits until the RSS is back
// down, then answers. Only VmHWM still shows the spike when the result comes:
// a parent that reads VmRSS alone every 50 ms all but never sees it.
// Needs --expose-gc (ChildEntry.nodeArgs).
import { readFileSync } from 'node:fs';

import { readInputFile, sendSuccess } from './child-frames.mjs';

const SPIKE_MIB = 400;
const SETTLE_MS = 300;

const statusKib = (field) =>
  Number(
    new RegExp(`^${field}:\\s*(\\d+)`, 'm').exec(
      readFileSync('/proc/self/status', 'utf8'),
    )?.[1],
  );

readInputFile();
// Filled, not just reserved, so every page is resident; unreferenced at once.
Buffer.alloc(SPIKE_MIB * 1024 * 1024, 1);
globalThis.gc();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);
sendSuccess(
  JSON.stringify({
    spikeMib: SPIKE_MIB,
    rssAtAnswerKib: statusKib('VmRSS'),
    hwmAtAnswerKib: statusKib('VmHWM'),
  }),
);
process.exit(0);
