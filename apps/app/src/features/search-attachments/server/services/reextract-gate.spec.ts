import { createReextractGate, ReextractDeadlineError } from './reextract-gate';

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createReextractGate', () => {
  it('lets later callers for the same key share the run in flight', async () => {
    const gate = createReextractGate<string>();
    const running = deferred<string>();
    const task = vi.fn(() => running.promise);

    const first = gate.run('a', task);
    const second = gate.run('a', task);
    running.resolve('done');

    await expect(first).resolves.toBe('done');
    await expect(second).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('starts a new run for the key once the previous one has settled', async () => {
    const gate = createReextractGate<string>();
    const task = vi.fn(async () => 'done');

    await gate.run('a', task);
    await gate.run('a', task);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('starts a new run for the key once the previous one has rejected', async () => {
    const gate = createReextractGate<string>();
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(gate.run('a', failing)).rejects.toThrow('boom');
    await expect(gate.run('a', async () => 'next')).resolves.toBe('next');
  });

  it('treats a task that throws synchronously like a rejected one', async () => {
    const gate = createReextractGate<string>();

    await expect(
      gate.run('a', () => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(gate.run('a', async () => 'next')).resolves.toBe('next');
  });

  describe('total deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects the caller of a run that never settles', async () => {
      const gate = createReextractGate<string>(1000);
      const hung = gate.run('a', () => new Promise<string>(() => {}));
      const assertion = expect(hung).rejects.toBeInstanceOf(
        ReextractDeadlineError,
      );

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });

    it('tells an abandoned task that no one waits for it any more', async () => {
      const gate = createReextractGate<string>(1000);
      let seen: AbortSignal | undefined;
      const hung = gate.run('a', (signal) => {
        seen = signal;
        return new Promise<string>(() => {});
      });
      const assertion = expect(hung).rejects.toBeInstanceOf(
        ReextractDeadlineError,
      );
      expect(seen?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      expect(seen?.aborted).toBe(true);
    });

    it('starts a fresh run for the same key after the deadline', async () => {
      const gate = createReextractGate<string>(1000);
      const hung = gate.run('a', () => new Promise<string>(() => {}));
      const assertion = expect(hung).rejects.toBeInstanceOf(
        ReextractDeadlineError,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      const task = vi.fn(async () => 'fresh');
      await expect(gate.run('a', task)).resolves.toBe('fresh');
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('does not remove a newer entry when an abandoned run settles late', async () => {
      const gate = createReextractGate<string>(1000);
      const old = deferred<string>();
      const abandoned = gate.run('a', () => old.promise);
      const assertion = expect(abandoned).rejects.toBeInstanceOf(
        ReextractDeadlineError,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      const newer = deferred<string>();
      const newerRun = gate.run('a', () => newer.promise);
      old.resolve('late');
      await vi.advanceTimersByTimeAsync(0);

      const joiner = vi.fn(async () => 'never');
      const joined = gate.run('a', joiner);
      newer.resolve('newer');
      await expect(newerRun).resolves.toBe('newer');
      await expect(joined).resolves.toBe('newer');
      expect(joiner).not.toHaveBeenCalled();
    });

    it('does not time out a run that settles before the deadline', async () => {
      const gate = createReextractGate<string>(1000);
      const running = deferred<string>();
      const run = gate.run('a', () => running.promise);
      await vi.advanceTimersByTimeAsync(999);
      running.resolve('ok');

      await expect(run).resolves.toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
