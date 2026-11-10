import type { ConversionOutcome, FailureKind } from '../contract';
import {
  CHILD_REPORTABLE_KINDS,
  encodeResult,
  MAX_DETAIL_CHARS,
  maxResultFrameBytes,
  WireProtocolError,
} from '../wire/length-prefixed-json';

const failure = (kind: FailureKind, detail: string): ConversionOutcome => ({
  kind: 'failed',
  failure: kind,
  detail,
});

const isReportable = (kind: FailureKind): boolean =>
  CHILD_REPORTABLE_KINDS.some((reportable) => reportable === kind);

// Cut by code points, so a surrogate pair is never split into a lone half.
const truncateDetail = (detail: string): string => {
  if (detail.length <= MAX_DETAIL_CHARS) {
    return detail;
  }
  let codePoints = 0;
  let end = 0;
  for (const char of detail) {
    if (codePoints === MAX_DETAIL_CHARS) {
      break;
    }
    codePoints += 1;
    end += char.length;
  }
  return detail.slice(0, end);
};

// The child holds itself to what the parent's decoder accepts, so a genuine
// failure is never turned into a protocol violation (and so `crashed`).
const reportable = (outcome: ConversionOutcome): ConversionOutcome => {
  if (outcome.kind === 'ok') {
    return outcome;
  }
  if (!isReportable(outcome.failure)) {
    return failure('internal', `unexpected failure kind ${outcome.failure}`);
  }
  return failure(outcome.failure, truncateDetail(outcome.detail));
};

const encodeReportable = (outcome: ConversionOutcome): Buffer => {
  try {
    return encodeResult(reportable(outcome));
  } catch (error) {
    if (error instanceof WireProtocolError) {
      return encodeResult(
        failure('internal', 'result text cannot be encoded as UTF-8'),
      );
    }
    throw error;
  }
};

/** The one result frame body the child sends; anything the wire cannot carry becomes a failure. */
export const encodeChildResult = (
  outcome: ConversionOutcome,
  maxResultBytes: number,
): Buffer => {
  const body = encodeReportable(outcome);
  if (body.length > maxResultFrameBytes(maxResultBytes)) {
    return encodeResult(
      failure('result_too_large', 'encoded result exceeds the limit'),
    );
  }
  return body;
};
