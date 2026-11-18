import {
  type DirectChild,
  endingWithin,
  spawnDirect,
} from './spec-support/direct-child';

// The parent watch (Req 3.11, research.md 15.1 / 15.3): a thread of its own
// reads fd 4 and ends the child at EOF, even while the main thread is stuck in
// synchronous code; and it must never keep the child from ending by itself.
// Python test_child_entry.py test_child_exits_within_2s_once_the_requesting_worker_drops_the_liveness_pipe
// (Node: 1 s, research.md 15.7) and the 15.6 rows where the child ends itself.

const WATCH_THEN = 'child/spec-support/watch-then.ts';

describe.skipIf(process.platform !== 'linux')('startParentWatch', () => {
  let child: DirectChild | undefined;

  afterEach(async () => {
    await child?.dispose();
    child = undefined;
  });

  const started = async (mode: string): Promise<DirectChild> => {
    child = spawnDirect(WATCH_THEN, [mode]);
    expect(await child.firstLine).toBe('watching');
    return child;
  };

  it('ends a child stuck in synchronous code within 1 s once the parent goes', async () => {
    const spinning = await started('spin');

    spinning.dropLiveness();

    expect(await endingWithin(spinning, 1_000)).not.toBe('still running');
  });

  // The control for the case above: without the watch, the same child
  // outlives its parent, so the case above is the watch's doing.
  it('is what ends it: an unwatched spinning child keeps running', async () => {
    const spinning = await started('spin-unwatched');

    spinning.dropLiveness();

    expect(await endingWithin(spinning, 1_500)).toBe('still running');
  });

  it('ends the child even when the parent goes before the watch is listening', async () => {
    const spinning = await started('spin-at-once');

    spinning.dropLiveness();

    expect(await endingWithin(spinning, 1_000)).not.toBe('still running');
  });

  // A watch that blocks its thread in a read keeps process.exit() and fatal
  // errors from ever returning (research.md 15.3): every such child would then
  // wait for the deadline and be misread as a timeout.
  it.each([
    ['exit-0', { code: 0, signal: null }],
    ['exit-1', { code: 1, signal: null }],
    ['throw', { code: 1, signal: null }],
    ['reject', { code: 1, signal: null }],
  ])('lets a watched child end by itself (%s) while the parent is still there', async (mode, ending) => {
    const watched = await started(mode);

    expect(await endingWithin(watched, 2_000)).toEqual(ending);
  });
});
