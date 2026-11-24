export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timeout after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Settles as `promise` does, or rejects with `createError()` once `ms` have
 * passed. The underlying work is not cancelled.
 */
export const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  createError: () => Error = () => new TimeoutError(ms),
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(createError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
