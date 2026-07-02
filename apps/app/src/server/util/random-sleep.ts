/**
 * Sleep for a random duration between 0 and maxMs.
 *
 * Used by cron services to de-synchronize scheduled work across multiple app
 * instances: setupCron() runs on every pod, so without jitter they would all
 * hit the DB / external endpoints at the same instant.
 */
export const randomSleep = (maxMs: number): Promise<void> => {
  const ms = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
};
