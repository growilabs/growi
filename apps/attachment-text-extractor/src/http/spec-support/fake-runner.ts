import { type MockProxy, mock } from 'vitest-mock-extended';

import type { FailureKind, PageInfo } from '../../contract';
import type {
  ConversionRunner,
  RunInput,
  RunOutcome,
} from '../../runner/conversion-runner';

// A stand-in for the runner: the HTTP layer's tests decide what a conversion
// "returns" without any child process (Python test_extract_router.py FakeRunner).

export const DETAIL_THAT_MUST_NOT_LEAK = 'internal detail that must not leak';

export const succeeded = (
  pages: readonly PageInfo[] = [
    { pageNumber: 1, label: '1', content: 'hello' },
  ],
  options: {
    readonly mimeType?: string;
    readonly childPeakRssMb?: number | null;
  } = {},
): RunOutcome => ({
  kind: 'ok',
  mimeType: options.mimeType ?? 'text/plain',
  pages,
  childPeakRssMb:
    options.childPeakRssMb === undefined ? 42 : options.childPeakRssMb,
});

export const failed = (
  failure: FailureKind,
  childPeakRssMb: number | null = 7,
): RunOutcome => ({
  kind: 'failed',
  failure,
  detail: DETAIL_THAT_MUST_NOT_LEAK,
  childPeakRssMb,
});

/** Ready, and every run succeeds with one "hello" page until a test says otherwise. */
export const fakeRunner = (): MockProxy<ConversionRunner> => {
  const runner = mock<ConversionRunner>();
  runner.run.mockResolvedValue(succeeded());
  runner.readiness.mockResolvedValue({ ready: true });
  return runner;
};

/** The file bytes the runner received, its chunks joined. */
export const forwardedBytes = (input: RunInput): Buffer =>
  Buffer.concat(input.chunks);

export interface HeldRun {
  readonly runner: MockProxy<ConversionRunner>;
  /** Resolves once the first run has begun, with its input and abort signal. */
  readonly started: Promise<{
    readonly input: RunInput;
    readonly signal: AbortSignal;
  }>;
  /** Resolves once that run's signal has aborted. */
  readonly aborted: Promise<void>;
  /** Resolves once that run has returned. */
  readonly finished: Promise<void>;
  /** Ends the run with `outcome` (a success by default). */
  release(outcome?: RunOutcome): void;
}

/**
 * A runner whose first run() waits until released, so a test knows a slot is
 * held without sleeping. With `endOnAbort` (the default) an aborted run ends at
 * once, as the real runner does after killing its child; without it the run
 * keeps going until released, standing in for a child still being reaped.
 */
export const holdingRunner = (
  options: { readonly endOnAbort?: boolean } = {},
): HeldRun => {
  const runner = fakeRunner();
  let markStarted: (value: { input: RunInput; signal: AbortSignal }) => void =
    () => {};
  let markAborted: () => void = () => {};
  let markFinished: () => void = () => {};
  let end: (outcome: RunOutcome) => void = () => {};
  const started = new Promise<{ input: RunInput; signal: AbortSignal }>(
    (resolve) => {
      markStarted = resolve;
    },
  );
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    markFinished = resolve;
  });
  runner.run.mockImplementationOnce(
    (input, signal) =>
      new Promise<RunOutcome>((resolve) => {
        end = (outcome) => {
          resolve(outcome);
          markFinished();
        };
        const onAbort = (): void => {
          markAborted();
          if (options.endOnAbort !== false) end(failed('crashed', null));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
        markStarted({ input, signal });
      }),
  );
  return {
    runner,
    started,
    aborted,
    finished,
    release: (outcome = succeeded()) => end(outcome),
  };
};
