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
    const gate = createReextractGate<string>(3);
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
    const gate = createReextractGate<string>(3);
    const task = vi.fn(async () => 'done');

    await gate.run('a', task);
    await gate.run('a', task);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('starts a new run for the key once the previous one has rejected', async () => {
    const gate = createReextractGate<string>(3);
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(gate.run('a', failing)).rejects.toThrow('boom');
    await expect(gate.run('a', async () => 'next')).resolves.toBe('next');
  });

  it('treats a task that throws synchronously like a rejected one', async () => {
    const gate = createReextractGate<string>(1);

    await expect(
      gate.run('a', () => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(gate.run('b', async () => 'free')).resolves.toBe('free');
  });

  it('refuses a new key while the cap is reached, without starting it', async () => {
    const gate = createReextractGate<string>(2);
    const running = deferred<string>();
    gate.run('a', () => running.promise);
    gate.run('b', () => running.promise);
    const task = vi.fn(async () => 'c');

    expect(gate.run('c', task)).toBeNull();
    expect(task).not.toHaveBeenCalled();
  });

  it('still lets a caller join a key in flight while the cap is reached', async () => {
    const gate = createReextractGate<string>(1);
    const running = deferred<string>();
    const first = gate.run('a', () => running.promise);

    const joined = gate.run('a', async () => 'never');
    running.resolve('done');

    await expect(first).resolves.toBe('done');
    await expect(joined).resolves.toBe('done');
  });

  it('frees a slot when a run settles', async () => {
    const gate = createReextractGate<string>(1);
    const running = deferred<string>();
    const first = gate.run('a', () => running.promise);
    expect(gate.run('b', async () => 'b')).toBeNull();

    running.reject(new Error('failed'));
    await expect(first).rejects.toThrow('failed');

    await expect(gate.run('b', async () => 'b')).resolves.toBe('b');
  });

  describe('total deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects the caller of a run that never settles and frees its slot', async () => {
      const gate = createReextractGate<string>(1, 1000);
      const hung = gate.run('a', () => new Promise<string>(() => {}));
      const assertion = expect(hung).rejects.toBeInstanceOf(
        ReextractDeadlineError,
      );

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      await expect(gate.run('b', async () => 'free')).resolves.toBe('free');
    });

    it('starts a fresh run for the same key after the deadline', async () => {
      const gate = createReextractGate<string>(3, 1000);
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
      const gate = createReextractGate<string>(3, 1000);
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

    it('keeps cap accounting correct across abandoned runs', async () => {
      const gate = createReextractGate<string>(2, 1000);
      const hung = ['a', 'b'].map((k) =>
        gate.run(k, () => new Promise<string>(() => {})),
      );
      const assertions = hung.map((h) =>
        expect(h).rejects.toBeInstanceOf(ReextractDeadlineError),
      );
      expect(gate.run('c', async () => 'c')).toBeNull();

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all(assertions);

      const running = deferred<string>();
      gate.run('c', () => running.promise);
      gate.run('d', () => running.promise);
      expect(gate.run('e', async () => 'e')).toBeNull();
    });

    it('does not time out a run that settles before the deadline', async () => {
      const gate = createReextractGate<string>(1, 1000);
      const running = deferred<string>();
      const run = gate.run('a', () => running.promise);
      await vi.advanceTimersByTimeAsync(999);
      running.resolve('ok');

      await expect(run).resolves.toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
