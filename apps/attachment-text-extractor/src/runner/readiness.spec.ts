import { sharedThenKept } from './readiness';
import { manualClock } from './spec-support';

// A check's result, ready or not, and a check that threw, are kept for a
// while after the check settles; callers during a check share it.

const KEEP_MS = 10_000;

interface Check {
  readonly ready: boolean;
}

/** A check whose every run waits until the test settles it. */
const scriptedCheck = () => {
  const pending: {
    resolve: (value: Check) => void;
    reject: (error: Error) => void;
  }[] = [];
  const task = vi.fn(
    () =>
      new Promise<Check>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  const latest = () => {
    const run = pending.at(-1);
    if (run === undefined) {
      throw new Error('no check has started');
    }
    return run;
  };
  return { task, latest };
};

const setUp = () => {
  const clock = manualClock();
  const check = scriptedCheck();
  const readiness = sharedThenKept(check.task, KEEP_MS, clock.now);
  return { clock, check, readiness };
};

describe('sharedThenKept', () => {
  it('answers from the kept result, without a new check, until 10 s after the check settled', async () => {
    const { clock, check, readiness } = setUp();
    const first = readiness();
    check.latest().resolve({ ready: true });
    await first;

    clock.advance(KEEP_MS);
    const kept = readiness();

    expect(check.task).toHaveBeenCalledTimes(1);
    expect(await kept).toEqual({ ready: true });
  });

  it('checks again once the kept result is older than 10 s', async () => {
    const { clock, check, readiness } = setUp();
    const first = readiness();
    check.latest().resolve({ ready: true });
    await first;

    clock.advance(KEEP_MS + 1);
    const again = readiness();
    check.latest().resolve({ ready: false });

    expect(await again).toEqual({ ready: false });
    expect(check.task).toHaveBeenCalledTimes(2);
  });

  it('keeps a not-ready result too', async () => {
    const { clock, check, readiness } = setUp();
    const first = readiness();
    check.latest().resolve({ ready: false });
    await first;

    clock.advance(KEEP_MS - 1);
    const kept = readiness();

    expect(check.task).toHaveBeenCalledTimes(1);
    expect(await kept).toEqual({ ready: false });
  });

  it('gives callers that arrive during a check that one check', async () => {
    const { check, readiness } = setUp();

    const answers = [readiness(), readiness(), readiness()];
    check.latest().resolve({ ready: true });

    expect(await Promise.all(answers)).toEqual([
      { ready: true },
      { ready: true },
      { ready: true },
    ]);
    expect(check.task).toHaveBeenCalledTimes(1);
  });

  it('keeps a check that threw, then checks again after 10 s', async () => {
    const { clock, check, readiness } = setUp();
    const failure = new Error('probe broke');
    const first = readiness();
    check.latest().reject(failure);
    await expect(first).rejects.toBe(failure);

    clock.advance(KEEP_MS);
    const kept = readiness();
    expect(check.task).toHaveBeenCalledTimes(1);
    await expect(kept).rejects.toBe(failure);

    clock.advance(1);
    const again = readiness();
    check.latest().resolve({ ready: true });
    expect(await again).toEqual({ ready: true });
    expect(check.task).toHaveBeenCalledTimes(2);
  });

  it('counts the 10 s from when a slow check settled, not from when it began', async () => {
    const { clock, check, readiness } = setUp();
    const first = readiness();
    clock.advance(8_000);
    check.latest().resolve({ ready: true });
    await first;

    clock.advance(KEEP_MS);
    const kept = readiness();
    expect(check.task).toHaveBeenCalledTimes(1);
    expect(await kept).toEqual({ ready: true });

    clock.advance(1);
    const again = readiness();
    check.latest().resolve({ ready: true });
    await again;
    expect(check.task).toHaveBeenCalledTimes(2);
  });

  it('shares a re-check that is running instead of answering from the expired result', async () => {
    const { clock, check, readiness } = setUp();
    const first = readiness();
    check.latest().resolve({ ready: false });
    await first;

    clock.advance(KEEP_MS + 1);
    const answers = [readiness(), readiness()];
    check.latest().resolve({ ready: true });

    expect(await Promise.all(answers)).toEqual([
      { ready: true },
      { ready: true },
    ]);
    expect(check.task).toHaveBeenCalledTimes(2);
  });
});
