import { createReextractGate } from './reextract-gate';

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
});
