/**
 * Ceiling on the work one page may be charged for, well above any real parse cost. Bounding the
 * charge rather than the resulting rest keeps the configured duty exact for every legitimate
 * measurement — clamping the rest instead raised the effective duty for expensive pages, worst at
 * a deliberately low duty, which is where the knob matters most.
 */
export const MAX_CHARGED_WORK_MS = 5000;

/**
 * The rest owed after `workMs` of thread time so that work is `dutyCyclePercent` of work plus
 * rest. Shared by the live drain and the backfill, so both pace by the same rule.
 *
 * @param dutyCyclePercent 1-100, already validated by the caller's pacing resolver
 */
export const restMsFor = (workMs: number, dutyCyclePercent: number): number => {
  if (!Number.isFinite(workMs) || workMs <= 0) return 0;
  const restRatio = (100 - dutyCyclePercent) / dutyCyclePercent;
  return Math.min(workMs, MAX_CHARGED_WORK_MS) * restRatio;
};
