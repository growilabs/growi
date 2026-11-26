export class DeadlineExceededError extends Error {
  constructor(message = 'Deadline exceeded') {
    super(message);
    this.name = 'DeadlineExceededError';
  }
}

/**
 * Resolve once the wall clock reaches `deadlineAt` (epoch ms).
 * Resolves immediately when the deadline has already passed.
 */
export const waitUntil = (deadlineAt: number): Promise<void> => {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, remainingMs);
  });
};

/**
 * Settle with `task` if it settles before `deadlineAt` (epoch ms),
 * otherwise reject with DeadlineExceededError.
 *
 * The task itself is not cancelled; a late rejection is swallowed here so it
 * never surfaces as an unhandled rejection. Callers that need the late outcome
 * must attach their own handler to `task`.
 */
export const runWithDeadline = async <T>(
  task: Promise<T>,
  deadlineAt: number,
): Promise<T> => {
  task.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DeadlineExceededError()),
      Math.max(0, deadlineAt - Date.now()),
    );
  });

  try {
    return await Promise.race([task, deadline]);
  } finally {
    clearTimeout(timer);
  }
};
