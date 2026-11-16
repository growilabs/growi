import { createCoalescingRunner } from './coalescing-runner';

interface Latch {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

const createLatch = (): Latch => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

/**
 * A task whose every run is held until the test releases it, recording how
 * many runs started and the most that were ever in progress together.
 */
const createHeldTask = () => {
  const runs: Latch[] = [];
  const started: Latch[] = [createLatch()];
  let inProgress = 0;
  let maxInProgress = 0;

  const task = async (): Promise<void> => {
    const run = createLatch();
    const index = runs.length;
    runs.push(run);
    started.push(createLatch());
    inProgress += 1;
    maxInProgress = Math.max(maxInProgress, inProgress);
    started[index].release();
    await run.promise;
    inProgress -= 1;
  };

  return {
    task,
    runCount: () => runs.length,
    maxInProgress: () => maxInProgress,
    /** Resolves once the run with this index (0-based) has started. */
    runStarted: (index: number) => started[index].promise,
    releaseRun: (index: number) => runs[index].release(),
  };
};

describe('createCoalescingRunner', () => {
  it('runs the task when nothing is running and resolves once it finishes', async () => {
    const held = createHeldTask();
    const request = createCoalescingRunner(held.task, vi.fn());
    let settled = false;

    const done = request().then(() => {
      settled = true;
    });
    await held.runStarted(0);
    expect(held.runCount()).toBe(1);
    expect(settled).toBe(false);

    held.releaseRun(0);
    await done;
    expect(settled).toBe(true);
  });

  it('turns any number of requests made during a run into exactly one more run after it', async () => {
    const held = createHeldTask();
    const request = createCoalescingRunner(held.task, vi.fn());

    const first = request();
    await held.runStarted(0);
    const duringFirst = [request(), request(), request()];
    expect(held.runCount()).toBe(1);

    held.releaseRun(0);
    await first;
    await held.runStarted(1);
    held.releaseRun(1);
    await Promise.all(duringFirst);

    expect(held.runCount()).toBe(2);
    expect(held.maxInProgress()).toBe(1);
  });

  it('never lets a requested run start before the running one has finished', async () => {
    const held = createHeldTask();
    const request = createCoalescingRunner(held.task, vi.fn());

    void request();
    await held.runStarted(0);
    const second = request();
    // Several turns of the event loop: a run that did not wait would start here.
    for (let i = 0; i < 10; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: yielding turn by turn on purpose
      await Promise.resolve();
    }
    expect(held.runCount()).toBe(1);

    held.releaseRun(0);
    await held.runStarted(1);
    held.releaseRun(1);
    await second;
    expect(held.maxInProgress()).toBe(1);
  });

  it('resolves a request made during a run only after the run that follows has finished', async () => {
    const held = createHeldTask();
    const request = createCoalescingRunner(held.task, vi.fn());
    let secondSettled = false;

    void request();
    await held.runStarted(0);
    const second = request().then(() => {
      secondSettled = true;
    });

    held.releaseRun(0);
    await held.runStarted(1);
    expect(secondSettled).toBe(false);

    held.releaseRun(1);
    await second;
    expect(secondSettled).toBe(true);
  });

  it('runs once more for a request made during the follow-up run', async () => {
    const held = createHeldTask();
    const request = createCoalescingRunner(held.task, vi.fn());

    void request();
    await held.runStarted(0);
    void request();
    held.releaseRun(0);
    await held.runStarted(1);

    const third = request();
    held.releaseRun(1);
    await held.runStarted(2);
    held.releaseRun(2);
    await third;

    expect(held.runCount()).toBe(3);
    expect(held.maxInProgress()).toBe(1);
  });

  it('runs again for a request made after everything has finished', async () => {
    const held = createHeldTask();
    const request = createCoalescingRunner(held.task, vi.fn());

    const first = request();
    await held.runStarted(0);
    held.releaseRun(0);
    await first;

    const second = request();
    await held.runStarted(1);
    held.releaseRun(1);
    await second;

    expect(held.runCount()).toBe(2);
  });

  describe('when the task fails', () => {
    it('resolves the request instead of rejecting it, and reports the error', async () => {
      const failure = new Error('drain exploded');
      const onError = vi.fn();
      const request = createCoalescingRunner(
        () => Promise.reject(failure),
        onError,
      );

      await expect(request()).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it('still runs the next request', async () => {
      const task = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('first run failed'))
        .mockResolvedValue(undefined);
      const request = createCoalescingRunner(task, vi.fn());

      await request();
      await request();

      expect(task).toHaveBeenCalledTimes(2);
    });

    it('still runs the follow-up for requests made during the failing run', async () => {
      const firstRun = createLatch();
      const task = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(async () => {
          await firstRun.promise;
          throw new Error('first run failed');
        })
        .mockResolvedValue(undefined);
      const request = createCoalescingRunner(task, vi.fn());

      const first = request();
      const duringFirst = request();
      firstRun.release();
      await first;
      await duringFirst;

      expect(task).toHaveBeenCalledTimes(2);
    });
  });
});
