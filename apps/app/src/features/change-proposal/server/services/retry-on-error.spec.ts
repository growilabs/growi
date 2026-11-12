import { retryOnError } from './retry-on-error';

describe('retryOnError', () => {
  const noWait = (): Promise<void> => Promise.resolve();

  it('returns the first result without waiting when the task succeeds', async () => {
    const task = vi.fn().mockResolvedValue('done');
    const wait = vi.fn(noWait);

    await expect(retryOnError(task, { retries: 2, wait })).resolves.toBe(
      'done',
    );
    expect(task).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('succeeds on the second attempt after one failure', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('done');

    await expect(
      retryOnError(task, { retries: 2, wait: noWait }),
    ).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the third attempt after two failures', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValue('done');

    await expect(
      retryOnError(task, { retries: 2, wait: noWait }),
    ).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('gives up after the given number of retries and rethrows the last error', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('last'))
      .mockResolvedValue('never reached');

    await expect(
      retryOnError(task, { retries: 2, wait: noWait }),
    ).rejects.toThrow('last');
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('does not retry a resolved false: only a thrown error is a failure', async () => {
    const task = vi.fn().mockResolvedValue(false);

    await expect(
      retryOnError(task, { retries: 2, wait: noWait }),
    ).resolves.toBe(false);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('waits between attempts, never after the last one', async () => {
    const events: string[] = [];
    const task = vi.fn((): Promise<never> => {
      events.push('attempt');
      return Promise.reject(new Error('always'));
    });
    const wait = (): Promise<void> => {
      events.push('wait');
      return Promise.resolve();
    };

    await expect(retryOnError(task, { retries: 2, wait })).rejects.toThrow();
    expect(events).toEqual(['attempt', 'wait', 'attempt', 'wait', 'attempt']);
  });
});
