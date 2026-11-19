/** setTimeout fires after 1 ms when the delay is above this (about 24.8 days). */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * A deadline given in seconds as a timer delay. A value too long for a timer
 * is accepted, as the Python service accepted it, and held at the longest
 * delay rather than refused at startup.
 */
export const toTimerDelayMs = (seconds: number): number =>
  Math.min(seconds * 1000, MAX_TIMER_DELAY_MS);
