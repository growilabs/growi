import { createConcurrencyLimit } from './concurrency-limit';

type Deferred = {
  promise: Promise<string>;
  resolve: (v: string) => void;
  reject: (e: Error) => void;
};

const deferred = (): Deferred => {
  let resolve: (v: string) => void = () => {};
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createConcurrencyLimit', () => {
  it('runs at most the given number of tasks at once and starts waiting ones in arrival order', async () => {
    const limit = createConcurrencyLimit(2);
    const tasks = Array.from({ length: 4 }, deferred);
    const started: number[] = [];

    const results = Promise.allSettled(
      tasks.map((task, i) =>
        limit(() => {
          started.push(i);
          return task.promise;
        }),
      ),
    );
    await vi.waitFor(() => expect(started).toEqual([0, 1]));

    tasks[1].resolve('one');
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    tasks[0].reject(new Error('zero failed'));
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    tasks[2].resolve('two');
    tasks[3].resolve('three');

    expect(await results).toEqual([
      { status: 'rejected', reason: new Error('zero failed') },
      { status: 'fulfilled', value: 'one' },
      { status: 'fulfilled', value: 'two' },
      { status: 'fulfilled', value: 'three' },
    ]);
  });

  it('frees the slot of a task that throws synchronously', async () => {
    const limit = createConcurrencyLimit(1);

    await expect(
      limit(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(limit(async () => 'next')).resolves.toBe('next');
  });
});
