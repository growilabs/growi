/**
 * Wrap `task` so that at most one run is in progress at a time. A request
 * made while a run is in progress schedules exactly one more run after it,
 * however many requests arrive meanwhile.
 *
 * The returned promise resolves once a run that started after the request
 * has finished, and never rejects: a failed run is handed to `onError`.
 */
export const createCoalescingRunner = (
  task: () => Promise<unknown>,
  onError: (err: unknown) => void,
): (() => Promise<void>) => {
  let running: Promise<void> | null = null;
  let followUp: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    try {
      await task();
    } catch (err) {
      onError(err);
    }
  };

  const request = (): Promise<void> => {
    if (running == null) {
      running = runOnce().finally(() => {
        running = null;
      });
      return running;
    }
    followUp ??= running.then(() => {
      followUp = null;
      return request();
    });
    return followUp;
  };

  return request;
};
