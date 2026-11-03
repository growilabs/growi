export type ReextractGate<T> = {
  /**
   * Runs `task` for `key`, or joins the run already in flight for `key`.
   * Returns null, without starting `task`, when `maxConcurrent` runs for
   * other keys are already in flight.
   * A run that has not settled after `deadlineMs` is abandoned: its slot is
   * freed and its callers are rejected with ReextractDeadlineError.
   */
  run(
    key: string,
    task: () => Promise<T>,
    deadlineMs?: number,
  ): Promise<T> | null;
};

/** Thrown to the callers of a run that did not settle within its deadline. */
export class ReextractDeadlineError extends Error {
  constructor() {
    super('Re-extraction did not finish within its deadline');
    this.name = 'ReextractDeadlineError';
  }
}

export const DEFAULT_REEXTRACT_DEADLINE_MS = 5 * 60 * 1000;

/**
 * Bounds re-extraction work in this process: one run per attachment at a
 * time (later callers share its result), at most `maxConcurrent` runs
 * overall, and a total deadline per run so work that hangs cannot hold a
 * slot forever. Callers must authorize each request before calling `run`.
 */
export const createReextractGate = <T>(
  maxConcurrent: number,
  defaultDeadlineMs: number = DEFAULT_REEXTRACT_DEADLINE_MS,
): ReextractGate<T> => {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key, task, deadlineMs = defaultDeadlineMs) {
      const running = inFlight.get(key);
      if (running != null) {
        return running;
      }
      if (inFlight.size >= maxConcurrent) {
        return null;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const started: Promise<T> = new Promise<T>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new ReextractDeadlineError()),
          deadlineMs,
        );
        (async () => task())().then(resolve, reject);
      }).finally(() => {
        clearTimeout(timer);
        // Runs once, when `started` settles (result or deadline); a late
        // settlement of an abandoned task is ignored by the promise above,
        // so it never reaches an entry a newer run has put under this key.
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
  };
};
