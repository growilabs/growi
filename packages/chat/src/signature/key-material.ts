// Bare judgement over a raw public-key value, independent of any declared
// contract type.
//
// `PublicKeyRegistration` (the type that will carry this value on the wire)
// is declared later by task 3.3 in .kiro/specs/chat-integration-protocol --
// this module intentionally does NOT import or declare that type, so it can
// be written before 3.3 exists and so 6.2's request-shape check can call
// this same function instead of re-writing the same judgement (design.md
// "ペアリング -- 申告された URL の扱い", `PublicKeyRegistration` doc).

/**
 * Result of judging whether a raw JWK-shaped value is fit to register as a
 * public key for MessageSignature verification. Mirrors the ok/reason shape
 * `VerifyResult` uses elsewhere in this package, rather than a bare
 * boolean, so a caller (task 6.2's shape check) can report *why* a
 * registration was rejected.
 */
export type KeyMaterialJudgement =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'wrong-key-type' | 'contains-secret-component';
    };

/**
 * `JsonWebKey` is a wide type -- it accepts elliptic-curve, RSA, and
 * symmetric keys alike, and a private key looks the same shape as a public
 * one. Accepting it as-is would let an unintended key type, or a
 * counterparty's private key, get registered as though it were a public
 * key. Checks, in order:
 *   - `kty` is `'OKP'` and `crv` is `'Ed25519'` (the only signature scheme
 *     this package uses)
 *   - the value carries no secret component (`d`)
 */
export const isValidPublicKeyMaterial = (
  value: Record<string, unknown>,
): KeyMaterialJudgement => {
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519') {
    return { ok: false, reason: 'wrong-key-type' };
  }
  if (value.d != null) {
    return { ok: false, reason: 'contains-secret-component' };
  }
  return { ok: true };
};
