import type { LeveledLog, Severity } from '../config/leveled-log';
import type { FailureKind } from '../contract';
import type { ChildWarningCode, ChildWarnings } from '../wire/child-warning';
import type { ChildFault } from './run-outcome';

// The wording of the runner's diagnostic lines (research.md 7.8). Every line
// is a fixed sentence with fixed fields whose values the parent produced
// itself: an errno name, a signal name, an exit code, a failure kind, a probe
// name. Nothing a child wrote and nothing of an upload is ever part of one.

/** What the parent starts: prlimit on Linux, node itself elsewhere. */
export type Launcher = 'prlimit' | 'node';

const FAULT_SENTENCES: Readonly<Record<ChildFault['cause'], string>> = {
  not_started: 'conversion child could not be started',
  not_reaped: 'conversion child did not exit after SIGKILL',
  signal: 'conversion child was killed by a signal',
  exit_code: 'conversion child exited without a result',
  invalid_result: 'conversion child sent an invalid result',
};

const WARNING_SENTENCES: Readonly<Record<ChildWarningCode, string>> = {
  oom_score_not_raised: 'could not raise its oom_score_adj',
  invalid_input_frame: 'received an invalid input frame',
  result_not_sent: 'could not send its result',
  failed_unexpectedly: 'failed unexpectedly',
};
const UNRECOGNISED_SENTENCE = 'wrote unrecognised output to its standard error';

const faultFields = (fault: ChildFault, launcher: Launcher): string => {
  switch (fault.cause) {
    case 'not_started':
      return `launcher=${launcher} error=${fault.errorCode}`;
    case 'signal':
      return `signal=${fault.signal}`;
    case 'exit_code':
      return `exit_code=${fault.code}`;
    default:
      return '';
  }
};

/** The line for one conversion whose child gave no usable result. */
export const faultLine = (
  fault: ChildFault,
  launcher: Launcher,
): { readonly severity: Severity; readonly message: string } => {
  const fields = faultFields(fault, launcher);
  return {
    // The one case where a process the service started may still be running.
    severity: fault.cause === 'not_reaped' ? 'ERROR' : 'WARNING',
    message:
      fields === ''
        ? FAULT_SENTENCES[fault.cause]
        : `${FAULT_SENTENCES[fault.cause]}: ${fields}`,
  };
};

/** The same facts as fields, for the line that says why the service is not ready. */
export const faultReason = (fault: ChildFault, launcher: Launcher): string =>
  `cause=${fault.cause} ${faultFields(fault, launcher)}`.trimEnd();

/** Why one probe does not count as converted when its child did answer, or got no time to. */
export const PROBE_CAUSES = {
  failed: (failure: FailureKind): string => `cause=failed result=${failure}`,
  unexpectedText: 'cause=unexpected_text',
  timeLimit: 'cause=time_limit',
} as const;

/** The not-ready reason: which probe failed first, then its cause fields. */
export const probeReason = (probe: string, cause: string): string =>
  `probe=${probe} ${cause}`;

/** At most one message per code and one for everything else, whatever the child wrote. */
const warningMessages = (warnings: ChildWarnings): string[] => {
  const sentences = warnings.codes.map((code) => WARNING_SENTENCES[code]);
  if (warnings.unrecognised) {
    sentences.push(UNRECOGNISED_SENTENCE);
  }
  return sentences.map((sentence) => `conversion child warning: ${sentence}`);
};

/** The lines of one conversion: what its child warned about, then how it failed. */
export const logConversion = (
  log: LeveledLog,
  launcher: Launcher,
  fault: ChildFault | null,
  warnings: ChildWarnings,
): void => {
  for (const message of warningMessages(warnings)) {
    log('WARNING', message);
  }
  if (fault !== null) {
    const { severity, message } = faultLine(fault, launcher);
    log(severity, message);
  }
};

/**
 * For the probe children: each warning is written the first time only.
 * /readyz needs no token and probes on every call, so a warning every probe
 * child repeats must not become a line per call.
 */
export const createOnceOnlyWarningLog = (
  log: LeveledLog,
): ((warnings: ChildWarnings) => void) => {
  const written = new Set<string>();
  return (warnings) => {
    for (const message of warningMessages(warnings)) {
      if (!written.has(message)) {
        written.add(message);
        log('WARNING', message);
      }
    }
  };
};

/**
 * Writes why the service is not ready when that changes, not on every check:
 * /readyz needs no token and probes on every call, so its callers must not be
 * able to fill the log. `reason` is null when ready.
 */
export const createReadinessLog = (
  log: LeveledLog,
): ((reason: string | null) => void) => {
  // undefined until the first check: a service that starts ready writes nothing.
  let last: string | null | undefined;
  return (reason) => {
    if (reason === last) {
      return;
    }
    if (reason !== null) {
      log('WARNING', `readiness probe failed: ${reason}`);
    } else if (last !== undefined) {
      log('INFO', 'readiness probe passed again');
    }
    last = reason;
  };
};
