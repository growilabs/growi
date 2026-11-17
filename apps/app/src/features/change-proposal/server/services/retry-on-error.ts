export type RetryOptions = {
  readonly retries: number;
  readonly wait: () => Promise<void>;
};

// Only a thrown error counts as a failure; any resolved value, false included, is final.
export const retryOnError = async <T>(
  task: () => Promise<T>,
  { retries, wait }: RetryOptions,
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: each attempt waits for the previous one to fail
      return await task();
    } catch (err) {
      if (attempt >= retries) {
        throw err;
      }
      await wait();
    }
  }
};
