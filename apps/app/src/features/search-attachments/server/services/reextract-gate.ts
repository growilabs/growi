export type ReextractGate<T> = {
  /**
   * Runs `task` for `key`, or joins the run already in flight for `key`.
   * Returns null, without starting `task`, when `maxConcurrent` runs for
   * other keys are already in flight.
   */
  run(key: string, task: () => Promise<T>): Promise<T> | null;
};

/**
 * Bounds re-extraction work in this process: one run per attachment at a
 * time (later callers share its result) and at most `maxConcurrent` runs
 * overall. Callers must authorize each request before calling `run`.
 */
export const createReextractGate = <T>(
  maxConcurrent: number,
): ReextractGate<T> => {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key, task) {
      const running = inFlight.get(key);
      if (running != null) {
        return running;
      }
      if (inFlight.size >= maxConcurrent) {
        return null;
      }
      const started = (async () => task())().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
  };
};
