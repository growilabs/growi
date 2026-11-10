import type { ConversionOutcome } from '../contract';
import type { ProbeInput } from './probe-inputs';

/** Converts one probe file in a real child, under the given time limit. */
export type ProbeConversion = (
  input: ProbeInput,
  timeoutS: number,
) => Promise<ConversionOutcome>;

const converted = (outcome: ConversionOutcome, input: ProbeInput): boolean =>
  outcome.kind === 'ok' &&
  outcome.pages.some((page) => page.content.includes(input.expectedText));

/**
 * Ready only when every probe converts, one child at a time, within one shared
 * time limit. A probe that starts no child (prlimit missing or not executable),
 * cannot load its entry, never answers, or cannot load a component fails.
 */
export const probeConversions = async (
  convert: ProbeConversion,
  inputs: readonly ProbeInput[],
  probeTimeoutS: number,
): Promise<boolean> => {
  const deadline = performance.now() + probeTimeoutS * 1000;
  for (const input of inputs) {
    const remainingS = (deadline - performance.now()) / 1000;
    if (remainingS <= 0) {
      return false;
    }
    // biome-ignore lint/performance/noAwaitInLoops: one probe child at a time, under one shared limit
    const outcome = await convert(input, remainingS);
    if (!converted(outcome, input)) {
      return false;
    }
  }
  return true;
};

/**
 * Callers that arrive while a check runs share it: /readyz needs no token, so
 * its callers must not be able to start probe children without bound. Nothing
 * is cached once a check ends, so readiness can come back after a failure.
 */
export const sharedWhileRunning = <T>(
  task: () => Promise<T>,
): (() => Promise<T>) => {
  let running: Promise<T> | null = null;
  return () => {
    running ??= task().finally(() => {
      running = null;
    });
    return running;
  };
};
