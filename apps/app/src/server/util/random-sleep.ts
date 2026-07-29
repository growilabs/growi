/**
 * Sleep for a random duration in [0, maxMs).
 *
 * Cron schedules fire at the same wall-clock instant on every app instance, so a
 * fleet of pods would otherwise hit the same DB or external endpoint at once.
 * Jittering the start de-synchronizes them. The delay only spreads the work out
 * — it does not serialize it — so callers must still be idempotent.
 */
export const randomSleep = (maxMs: number): Promise<void> => {
  const ms = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
};
