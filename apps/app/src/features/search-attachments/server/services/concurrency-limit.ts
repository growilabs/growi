/** Runs `task` once a slot is free; callers past the limit wait in arrival order. */
export type ConcurrencyLimit = <T>(task: () => Promise<T>) => Promise<T>;

export const createConcurrencyLimit = (max: number): ConcurrencyLimit => {
  let running = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next != null) {
      // The slot passes straight to the next caller
      next();
      return;
    }
    running -= 1;
  };

  return async (task) => {
    if (running < max) {
      running += 1;
    } else {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
};
