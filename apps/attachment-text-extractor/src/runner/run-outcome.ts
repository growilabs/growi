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
const decodedResult = (body: Buffer, peakRssKib: number): Outcome => {
  let outcome: ConversionOutcome;
  try {
    outcome = decodeResult(body);
  } catch {
    return failed(
      'crashed',
      'conversion process sent an invalid result',
      peakRssKib,
    );
  }
  return { ...outcome, childPeakRssMb: peakRssMb(peakRssKib) };
};

const outcomeOfEnding = (
  ending: ChildRunEnding,
  peakRssKib: number,
): Outcome => {
  switch (ending.kind) {
    case 'result':
      return decodedResult(ending.body, peakRssKib);
    case 'decided': {
      const { failure, detail } = DECISION_FAILURES[ending.decision];
      return failed(failure, detail, peakRssKib);
    }
    case 'not-started':
      return failed('crashed', 'conversion process could not be started', 0);
    case 'exited': {
      const failure = classifyExit(ending.code, ending.signal);
      return failure === 'timeout'
        ? failed(failure, DECISION_FAILURES.timeout.detail, peakRssKib)
        : failed(failure, exitDetail(ending.code, ending.signal), peakRssKib);
    }
  }
};

export const outcomeOf = (report: ChildRunReport): Outcome =>
  outcomeOfEnding(report.ending, report.peakRssKib);
