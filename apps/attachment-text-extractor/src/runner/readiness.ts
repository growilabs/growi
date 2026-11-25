import type { ConversionOutcome } from '../contract';
import { PROBE_CAUSES, probeReason } from './diagnostics';
import type { ProbeInput } from './probe-inputs';

export interface ProbeRun {
  readonly outcome: ConversionOutcome;
  /** `cause=…` fields when the probe child ended without a usable result, else null. */
  readonly faultReason: string | null;
}

/** Converts one probe file in a real child, under the given time limit. */
export type ProbeConversion = (
  input: ProbeInput,
  timeoutS: number,
) => Promise<ProbeRun>;

/** Why this probe does not count as converted, as fixed fields; null when it does. */
const failureOf = (
  { outcome, faultReason }: ProbeRun,
  input: ProbeInput,
): string | null => {
  if (outcome.kind === 'failed') {
    return faultReason ?? PROBE_CAUSES.failed(outcome.failure);
  }
  return outcome.pages.some((page) => page.content.includes(input.expectedText))
    ? null
    : PROBE_CAUSES.unexpectedText;
};

/**
 * Ready only when every probe converts, one child at a time, within one shared
 * time limit. A probe that starts no child (prlimit missing or not executable),
 * cannot load its entry, never answers, or cannot load a component fails.
 * Returns null when ready, otherwise which probe failed first and why, as
 * fixed fields for the log (never for the /readyz answer).
 */
export const probeConversions = async (
  convert: ProbeConversion,
  inputs: readonly ProbeInput[],
  probeTimeoutS: number,
): Promise<string | null> => {
  const deadline = performance.now() + probeTimeoutS * 1000;
  for (const input of inputs) {
    const remainingS = (deadline - performance.now()) / 1000;
    if (remainingS <= 0) {
      return probeReason(input.name, PROBE_CAUSES.timeLimit);
    }
    // biome-ignore lint/performance/noAwaitInLoops: one probe child at a time, under one shared limit
    const failure = failureOf(await convert(input, remainingS), input);
    if (failure !== null) {
      return probeReason(input.name, failure);
    }
  }
  return null;
};

/**
 * Callers that arrive while a check runs share it, and a settled check (ready,
 * not ready, or thrown) answers every caller for `keepMs` after it settled:
 * /readyz needs no token, so its callers must not be able to start probe
 * children without bound. Why the result is kept, and counted from the end of
 * the check: research.md §9.4.
 */
export const sharedThenKept = <T>(
  task: () => Promise<T>,
  keepMs: number,
  now: () => number,
): (() => Promise<T>) => {
  let latest: Promise<T> | null = null;
  // null while `latest` is still running.
  let settledAt: number | null = null;
  return () => {
    if (
      latest !== null &&
      (settledAt === null || now() - settledAt <= keepMs)
    ) {
      return latest;
    }
    const check = task();
    const markSettled = () => {
      if (latest === check) {
        settledAt = now();
      }
    };
    latest = check;
    settledAt = null;
    check.then(markSettled, markSettled);
    return check;
  };
};
