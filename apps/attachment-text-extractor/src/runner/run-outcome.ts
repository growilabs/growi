import type { ConversionOutcome, FailureKind } from '../contract';
import { decodeResult } from '../wire/length-prefixed-json';
import { classifyExit } from './child-exit';
import type {
  ChildRunEnding,
  ChildRunReport,
  ParentDecision,
} from './child-run';

// The outcome a run() returns; structurally RunOutcome, declared here so this
// module does not import conversion-runner.ts.
type Outcome = ConversionOutcome & { readonly childPeakRssMb: number | null };

/**
 * How a child ended when the failure kind alone does not tell the operator
 * what to look at. Built from what the parent saw (the start error's errno
 * name, the exit code, the signal), never from what the child wrote.
 */
export type ChildFault =
  | { readonly cause: 'not_started'; readonly errorCode: string }
  | { readonly cause: 'not_reaped' }
  | { readonly cause: 'signal'; readonly signal: NodeJS.Signals }
  | { readonly cause: 'exit_code'; readonly code: number }
  | { readonly cause: 'invalid_result' };

export interface RunReading {
  readonly outcome: Outcome;
  /** null when the child gave a valid result or the parent stopped it itself. */
  readonly fault: ChildFault | null;
}

const KIB = 1024;

// Fixed texts, the same as Python's child_supervision: nothing taken from the
// input or from what the child wrote ever reaches a detail.
const DECISION_FAILURES: Readonly<
  Record<
    ParentDecision,
    { readonly failure: FailureKind; readonly detail: string }
  >
> = {
  timeout: { failure: 'timeout', detail: 'conversion exceeded the time limit' },
  memory_exceeded: {
    failure: 'memory_exceeded',
    detail: 'conversion exceeded the memory limit',
  },
  result_too_large: {
    failure: 'result_too_large',
    detail: 'result exceeds the size limit',
  },
  // The caller has gone and answers nothing; crashed is what the HTTP layer's
  // fake runner also reports for an aborted run.
  aborted: { failure: 'crashed', detail: 'conversion was cancelled' },
};

/** Python's peak_rss_mb: whole MiB rounded up, null when nothing was read. */
const peakRssMb = (peakRssKib: number): number | null =>
  peakRssKib > 0 ? Math.ceil(peakRssKib / KIB) : null;

export const failed = (
  failure: FailureKind,
  detail: string,
  peakRssKib: number,
): Outcome => ({
  kind: 'failed',
  failure,
  detail,
  childPeakRssMb: peakRssMb(peakRssKib),
});

const exitDetail = (
  code: number | null,
  signal: NodeJS.Signals | null,
): string => {
  if (signal !== null) {
    return `conversion process was killed by signal ${signal}`;
  }
  if (code !== null) {
    return `conversion process exited with code ${code} without a result`;
  }
  return 'conversion process closed its result pipe without a result';
};

/** Decoded as JSON data only; anything that breaks the protocol is a crash (Req 3.9). */
const readResult = (body: Buffer, peakRssKib: number): RunReading => {
  let outcome: ConversionOutcome;
  try {
    outcome = decodeResult(body);
  } catch {
    return {
      outcome: failed(
        'crashed',
        'conversion process sent an invalid result',
        peakRssKib,
      ),
      fault: { cause: 'invalid_result' },
    };
  }
  return {
    outcome: { ...outcome, childPeakRssMb: peakRssMb(peakRssKib) },
    fault: null,
  };
};

const exitFault = (
  code: number | null,
  signal: NodeJS.Signals | null,
): ChildFault | null => {
  if (signal !== null) {
    return { cause: 'signal', signal };
  }
  return code === null ? null : { cause: 'exit_code', code };
};

const readEnding = (ending: ChildRunEnding, peakRssKib: number): RunReading => {
  switch (ending.kind) {
    case 'result':
      return readResult(ending.body, peakRssKib);
    case 'decided': {
      const { failure, detail } = DECISION_FAILURES[ending.decision];
      return { outcome: failed(failure, detail, peakRssKib), fault: null };
    }
    case 'not-started':
      return {
        outcome: failed(
          'crashed',
          'conversion process could not be started',
          0,
        ),
        fault: { cause: 'not_started', errorCode: ending.errorCode },
      };
    case 'exited': {
      const failure = classifyExit(ending.code, ending.signal);
      return {
        outcome:
          failure === 'timeout'
            ? failed(failure, DECISION_FAILURES.timeout.detail, peakRssKib)
            : failed(
                failure,
                exitDetail(ending.code, ending.signal),
                peakRssKib,
              ),
        fault: exitFault(ending.code, ending.signal),
      };
    }
  }
};

export const readReport = (report: ChildRunReport): RunReading => {
  const reading = readEnding(report.ending, report.peakRssKib);
  // A child that outlives its SIGKILL is the fault to report, whatever else happened.
  return report.reaped
    ? reading
    : { ...reading, fault: { cause: 'not_reaped' } };
};
