import { DeadlineExceededError, runWithDeadline, waitUntil } from './deadline';

describe('deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('waitUntil', () => {
    it('resolves exactly when the deadline is reached', async () => {
      let resolved = false;
      waitUntil(1000).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it('resolves immediately when the deadline has already passed', async () => {
      vi.setSystemTime(2000);
      let resolved = false;
      waitUntil(1000).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });
  });

  describe('runWithDeadline', () => {
    it('resolves with the task result when the task finishes in time', async () => {
      const task = new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), 500);
      });
      const result = runWithDeadline(task, 1000);

      await vi.advanceTimersByTimeAsync(500);
      await expect(result).resolves.toBe('done');
    });

    it('rejects with the task error when the task fails in time', async () => {
      const task = Promise.reject(new Error('smtp failure'));

      await expect(runWithDeadline(task, 1000)).rejects.toThrow('smtp failure');
    });

    it('rejects with DeadlineExceededError once the deadline passes', async () => {
      const result = runWithDeadline(new Promise<string>(() => {}), 1000);
      const assertion = expect(result).rejects.toBeInstanceOf(
        DeadlineExceededError,
      );

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });

    it('does not reject before the deadline while the task is pending', async () => {
      let settled = false;
      runWithDeadline(new Promise(() => {}), 1000).catch(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
    });
  });
});
