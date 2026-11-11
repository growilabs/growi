import { PassThrough } from 'node:stream';

import { MAX_CHILD_WARNING_BYTES } from '../wire/child-warning';
import { readChildWarnings } from './stderr-warnings';

// How much of a child's standard error the parent keeps: a fixed number of
// bytes, however much the child writes. A code that arrives after them is not
// seen, which is what shows that nothing beyond them was kept.

const MIB = 1024 * 1024;

const flushed = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('readChildWarnings', () => {
  it('reports nothing for a child that writes nothing', async () => {
    const stderr = new PassThrough();
    const warnings = readChildWarnings(stderr);

    stderr.end();
    await flushed();

    expect(warnings()).toEqual({ codes: [], unrecognised: false });
  });

  it('reads a code that arrives in pieces', async () => {
    const stderr = new PassThrough();
    const warnings = readChildWarnings(stderr);

    stderr.write('oom_score_');
    await flushed();
    stderr.write('not_raised\n');
    await flushed();

    expect(warnings()).toEqual({
      codes: ['oom_score_not_raised'],
      unrecognised: false,
    });
  });

  it('keeps the first bytes only: a code after them is not seen', async () => {
    const stderr = new PassThrough();
    const warnings = readChildWarnings(stderr);

    stderr.write(`${'\n'.repeat(MAX_CHILD_WARNING_BYTES)}result_not_sent\n`);
    await flushed();

    expect(warnings()).toEqual({ codes: [], unrecognised: true });
  });

  it('keeps reading, so megabytes never back up into the child', async () => {
    const stderr = new PassThrough({ highWaterMark: 1024 });
    const warnings = readChildWarnings(stderr);
    const chunk = Buffer.alloc(MIB, 0x2e);

    for (let written = 0; written < 16; written += 1) {
      stderr.write(chunk);
      // biome-ignore lint/performance/noAwaitInLoops: each megabyte must be read before the next
      await flushed();
      expect(stderr.readableLength).toBe(0);
    }

    expect(warnings()).toEqual({ codes: [], unrecognised: true });
  });

  it('reports nothing when the child has no standard error', () => {
    expect(readChildWarnings(null)()).toEqual({
      codes: [],
      unrecognised: false,
    });
  });
});
