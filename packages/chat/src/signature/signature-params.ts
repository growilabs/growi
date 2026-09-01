// The RFC 9421 `@signature-params` bucket: which values travel alongside the
// covered components, and which signature scheme this package uses.
//
// Separate from `covered-components.ts` because it is a separate list with a
// separate meaning, and separate from `sign.ts` / `verify.ts` because both
// sides need it: the signing side to emit every one of them, the verifying
// side to refuse a signature that leaves one out.

/**
 * The signature parameters. RFC 9421 carries these in `@signature-params`,
 * which is covered by the signature even though it is not in
 * `COVERED_COMPONENTS` -- requirement 10.3 (expiry) and 10.4 (replay) both
 * rest on that.
 *
 * **This is a declaration of which values are covered, not of a serialization
 * order.** The signing side may emit them in this order because it builds the
 * header from scratch; the verifying side must keep the order it received
 * (RFC 9421 section 3.2 step 7), or a peer that serializes them differently
 * is rejected although nothing was tampered with.
 */
export const SIGNATURE_PARAMS = [
  'created',
  'expires',
  'nonce',
  'keyid',
  'alg',
] as const;

export type SignatureParamName = (typeof SIGNATURE_PARAMS)[number];

/**
 * The only signature scheme this package uses: the RFC 9421 `alg` value for
 * Ed25519, which happens to spell the same as `node:crypto`'s
 * `KeyObject#asymmetricKeyType`.
 *
 * The verifying side compares the `alg` a request declares against the scheme
 * of the key it has stored; it never picks a primitive from the declared
 * value (design.md `MessageSignature` Invariants).
 */
export const SIGNATURE_ALGORITHM = 'ed25519' as const;
