// The conversion child's entry script; it runs on load. Started by the runner
// through prlimit with fd 0 = input frames (header, then file), fd 1 = discarded,
// fd 2 = warning codes, fd 3 = the one result frame, fd 4 = liveness.
//
// Only warning codes are ever written to stderr: a message can quote the
// input, and the parent logs its own sentence for a code, never what it read.
import type { ConversionOutcome } from '../contract';
import { convert } from '../conversion';
import {
  type ChildHeader,
  decodeChildHeader,
  MAX_CHILD_HEADER_BYTES,
} from '../wire/child-header';
import {
  type ChildWarningCode,
  encodeChildWarning,
} from '../wire/child-warning';
import { WireProtocolError } from '../wire/length-prefixed-json';
import { encodeChildResult } from './child-result';
import { readFrameSync, writeFrameSync } from './frame-io';
import { raiseOomScore } from './oom-score';
import { startParentWatch } from './parent-watch';

const INPUT_FD = 0;
const RESULT_FD = 3;
// The same code as Python's child_entry; the parent reads any ending without a
// result as `crashed`, so the value is for people reading a log.
const BAD_INPUT_EXIT_CODE = 4;
const UNEXPECTED_EXIT_CODE = 1;
// A failure body is a few hundred bytes, far below any result ceiling.
const FAILURE_RESULT_BYTES = 0;

interface ChildInput {
  readonly header: ChildHeader;
  readonly bytes: Buffer;
}

const warn = (code: ChildWarningCode): void => {
  process.stderr.write(encodeChildWarning(code));
};

const nameOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.name : 'non-Error value';

const internalResult = (thrown: unknown): Buffer =>
  encodeChildResult(
    { kind: 'failed', failure: 'internal', detail: nameOf(thrown) },
    FAILURE_RESULT_BYTES,
  );

/** Sends at most one frame however often it is called; true if this call delivered it. */
const createResultSender = (): ((body: Buffer) => boolean) => {
  let used = false;
  return (body) => {
    if (used) {
      return false;
    }
    used = true;
    try {
      writeFrameSync(RESULT_FD, body);
      return true;
    } catch {
      return false;
    }
  };
};

const sendResult = createResultSender();

const endUnexpectedly = (thrown: unknown): void => {
  warn('failed_unexpectedly');
  sendResult(internalResult(thrown));
  process.exit(UNEXPECTED_EXIT_CODE);
};

const readInputOrExit = (): ChildInput => {
  try {
    const header = decodeChildHeader(
      readFrameSync(INPUT_FD, MAX_CHILD_HEADER_BYTES),
    );
    return { header, bytes: readFrameSync(INPUT_FD, header.maxInputBytes) };
  } catch (error) {
    if (!(error instanceof WireProtocolError)) {
      throw error;
    }
    warn('invalid_input_frame');
    return process.exit(BAD_INPUT_EXIT_CODE);
  }
};

interface Converted {
  readonly outcome: ConversionOutcome;
  readonly maxResultBytes: number;
}

// Conversion, encoding and sending are separate steps, so that the input is
// not held while the result is encoded and the pages are not held while the
// frame is written.
const convertInput = async ({
  header,
  bytes,
}: ChildInput): Promise<Converted> => ({
  outcome: await convert(
    bytes,
    header.fileName,
    header.mimeHint,
    header.limits,
  ),
  maxResultBytes: header.limits.maxResultBytes,
});

const encodeConverted = ({ outcome, maxResultBytes }: Converted): Buffer =>
  encodeChildResult(outcome, maxResultBytes);

const main = async (): Promise<void> => {
  // Before anything is read, so the score is in place for the whole conversion.
  if (!raiseOomScore()) {
    warn('oom_score_not_raised');
  }
  await startParentWatch();
  const body = encodeConverted(await convertInput(readInputOrExit()));
  if (!sendResult(body)) {
    warn('result_not_sent');
  }
  process.exit(0);
};

process.on('uncaughtException', endUnexpectedly);
process.on('unhandledRejection', endUnexpectedly);
main().catch(endUnexpectedly);
