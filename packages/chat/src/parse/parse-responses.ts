// Response-side shape parsers whose validated value gets written straight
// into persisted state (design.md's callout box above the parse*
// signatures: "受け取るものは、要求も応答も、使う前に必ず検査関数を通す" --
// a response carries no signature, so the shape check here is the ONLY
// acceptance gate, not a secondary one layered on top of signature
// verification). design.md's File Structure Plan comments this file as
// holding all 7 of the package's response-side parsers; task 6.4 adds the
// first one (`parseKeyOperationResult`), and task 6.5 adds the remaining 6
// into this same file afterward.

import type { KeyOperationResult } from '../contract/pairing.js';
import { isRecord, oneOf } from './shape.js';

const STATUS_VALUES = ['ok', 'rejected'] as const;
const REJECTION_REASONS = [
  'would-leave-no-valid-key',
  'unknown-key',
  'invalid-key',
] as const;

type ParseError = { readonly error: 'malformed' };

/**
 * Confirms the wire shape of `KeyOperationResult` (Requirement 10.5/10.6's
 * key add/revoke round trip). A malformed value here does not just fail
 * one request -- whichever side calls this treats the parsed result as
 * whether a key rotation is complete, so an unchecked value can corrupt
 * that bookkeeping in a way nobody can trace back to the cause later
 * (design.md's rationale for this whole file).
 */
export const parseKeyOperationResult = (
  raw: unknown,
): KeyOperationResult | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const status = oneOf(raw.status, STATUS_VALUES);
  if (status === undefined) {
    return { error: 'malformed' };
  }

  if (status === 'ok') {
    return { status: 'ok' };
  }

  const reason = oneOf(raw.reason, REJECTION_REASONS);
  if (reason === undefined) {
    return { error: 'malformed' };
  }

  return { status: 'rejected', reason };
};
