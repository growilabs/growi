import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  type DirectChild,
  endingWithin,
  spawnDirect,
} from './spec-support/direct-child';

// The real child entry started directly, without the runner, so the test owns
// every byte on its pipes (Python test_child_entry.py's "real process boundary"
// cases). A good file and a broken one through the whole runner are in
// runner/conversion-runner.integ.ts; the limits prlimit sets are in
// runner/process-limits.integ.ts.

const CHILD_ENTRY = 'child/child-entry.ts';
const oomScoreAdj = (pid: number): string =>
  readFileSync(`/proc/${pid}/oom_score_adj`, 'utf8').trim();

/** Polls until the child entry has raised its own OOM score: it is running. */
const waitUntilStarted = async (
  child: DirectChild,
  timeoutMs = 10_000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (oomScoreAdj(child.pid) === '1000') {
        return true;
      }
    } catch {
      return false; // the child is gone
    }
    await sleep(10);
  }
  return false;
};

describe.skipIf(process.platform !== 'linux')(
  'the child entry as a process',
  () => {
    let child: DirectChild | undefined;

    afterEach(async () => {
      await child?.dispose();
      child = undefined;
    });

    // design.md "子プロセスの中の流れ": the score is raised first, so the kernel
    // picks the child, not the HTTP process, when memory runs out.
    it('raises its oom_score_adj to 1000 before it reads any input', async () => {
      child = spawnDirect(CHILD_ENTRY);

      // No input is ever sent: the score can only have been set before reading.
      expect(await waitUntilStarted(child)).toBe(true);
      expect(oomScoreAdj(child.pid)).toBe('1000');
    });

    // Req 3.11. The input pipe stays open and empty, so the child is waiting for
    // its input; only the parent watch can end it.
    it('ends within 1 s once the parent drops the liveness pipe', async () => {
      child = spawnDirect(CHILD_ENTRY);
      expect(await waitUntilStarted(child)).toBe(true);

      // A watch that is not listening yet still sees the EOF once it is (research.md 15.10).
      child.dropLiveness();

      expect(await endingWithin(child, 1_000)).not.toBe('still running');
    });

    // Each case first waits for the entry to be running: a file node cannot
    // load would also end without a result.
    it('rejects an absurd length header without sending a result', async () => {
      child = spawnDirect(CHILD_ENTRY);
      expect(await waitUntilStarted(child)).toBe(true);

      child.input.write(Buffer.from([0xff, 0xff, 0xff, 0xff]));

      const ending = await endingWithin(child, 10_000);
      expect(ending).not.toBe('still running');
      expect(await child.result).toEqual(Buffer.alloc(0));
    });

    it('rejects input that is cut short without sending a result', async () => {
      child = spawnDirect(CHILD_ENTRY);
      expect(await waitUntilStarted(child)).toBe(true);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(1000, 0);

      child.input.end(Buffer.concat([header, Buffer.from('x'.repeat(10))]));

      const ending = await endingWithin(child, 10_000);
      expect(ending).not.toBe('still running');
      expect(await child.result).toEqual(Buffer.alloc(0));
    });
  },
);
