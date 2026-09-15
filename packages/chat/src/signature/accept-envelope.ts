// The cross-check every signed body goes through after `verify` succeeds.
//
// See design.md's MessageSignature invariants: "本文に載せた `relationId` が、
// 署名から特定した関係と一致しない" and "本体の `op` が、実際に叩かれた口と
// 一致しない".

import type { OpName } from '../endpoints/op-names.js';
import type { KeyRef } from './key-identity.js';

/**
 * Confirms that the relation the signature identified agrees with the body's
 * own `relationId` and `op`. **An endpoint must put every signed body through
 * this before using it** (Requirement 10.1, 10.7).
 *
 * It exists as a function, not as prose in the design, because otherwise both
 * sides would remember and re-implement it separately -- which is at odds with
 * the reason this package exists.
 *
 * Two things it closes, neither of which `verify` can see:
 *
 * - `verify` proves only that the bytes were signed by the key of the
 *   relation named in `keyid`. A body validly signed with one relation's key
 *   may still claim another relation, and anything downstream trusting the
 *   body would then act on a relation that authorized nothing.
 * - The signature covers neither the target URL nor the path -- a reverse
 *   proxy rewrites both -- so `op` in the body is the only thing tying a
 *   signature to one endpoint. Only the receiving side knows which endpoint
 *   physically got the bytes, so it passes that in as `endpointOp`.
 *
 * `op` is NOT re-checked for membership in `OP_NAMES` here: `T` is already a
 * typed, parsed body whose `op` is an `OpName` (the shape parsers own turning
 * raw JSON into that type), so re-checking would put the same rule in two
 * places.
 */
export const acceptEnvelope = <T extends { relationId: string; op: OpName }>(
  body: T,
  verified: KeyRef,
  endpointOp: OpName,
):
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly failure: 'malformed' } => {
  if (body.relationId !== verified.relationId) {
    return { ok: false, failure: 'malformed' };
  }
  if (body.op !== endpointOp) {
    return { ok: false, failure: 'malformed' };
  }
  // The body is returned as-is: callers use the returned value, and copying
  // or normalizing it here would let the accepted value drift from the bytes
  // the signature covered.
  return { ok: true, body };
};
