export type ReextractGate<T> = {
  /**
   * Runs `task` for `key`, or joins the run already in flight for `key`.
   * A run that has not settled after `deadlineMs` is abandoned: its key is
   * freed and its callers are rejected with ReextractDeadlineError.
   */
  run(key: string, task: () => Promise<T>, deadlineMs?: number): Promise<T>;
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
 * One re-extraction run per attachment at a time (later callers share its
 * result), with a total deadline per run so a caller never waits forever.
 * How many files are extracted at once is bounded by the extractor service
 * itself. Callers must authorize each request before calling `run`.
 */
export const createReextractGate = <T>(
  defaultDeadlineMs: number = DEFAULT_REEXTRACT_DEADLINE_MS,
): ReextractGate<T> => {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key, task, deadlineMs = defaultDeadlineMs) {
      const running = inFlight.get(key);
      if (running != null) {
        return running;
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
