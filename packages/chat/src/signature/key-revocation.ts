// Bare judgement over whether a key-revocation request may proceed,
// independent of any declared contract type.
//
// `PublicKeyRegistration` / `PublicKeySet` (the types that carry a key's
// registration on the wire) are declared by task 3.3 in
// .kiro/specs/chat-integration-protocol -- this module intentionally does
// NOT import or declare those types, so it can be written before 3.3 exists
// (design.md "足りない往復を含む、鍵の追加と失効").
//
// Storage of the key list belongs to each side (GROWI app / proxy). This
// judgement itself does not: if the "would this leave zero valid keys"
// check were copied into both sides' revocation handlers separately, one
// side drifting from the other would make that side's guard silently
// looser (Requirement 10.5, 10.6). Both sides must call this one function
// instead.

/**
 * One key's identity and its validity period, reduced to the two facts
 * this judgement needs: when the key becomes active, and whether it has
 * already been revoked. A key counts as *currently valid* only when both
 * hold: `validFrom` has passed (the key is active) AND `revokedAt == null`
 * (the key's validity period has not been closed). A key with a
 * still-future `validFrom` -- e.g. one registered ahead of a rotation --
 * does NOT count as valid yet, even though it has never been revoked
 * (design.md "ペアリング -- 申告された URL の扱い", Requirement 10.5, 10.6).
 */
export interface RevocableKeyEntry {
  readonly keyId: string;
  readonly validFrom: string;
  readonly revokedAt: string | null;
}

/**
 * Result of judging whether a `keyId` may be revoked from a given key
 * list. Mirrors the ok/reason shape used elsewhere in this package
 * (`KeyMaterialJudgement`) so a caller can report *why* a revocation was
 * rejected, and can translate this 1:1 into `KeyOperationResult`'s
 * `'rejected'` reasons (`'would-leave-no-valid-key'` / `'unknown-key'`).
 */
export type KeyRevocationJudgement =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'would-leave-no-valid-key' | 'unknown-key';
    };

/**
 * Judges whether revoking `keyIdToRevoke` from `keys` may proceed, as of
 * `now`.
 *
 * `now` is supplied by the caller rather than read from the clock inside
 * this function, so the judgement stays pure and deterministically
 * testable (the same convention task 4.2's `judgeGrowiUri` established for
 * this package: external state comes in as a parameter, not `Date.now()`).
 *
 * - A `keyId` absent from `keys` is rejected as `'unknown-key'` -- there is
 *   nothing to revoke, and accepting it silently would let a caller believe
 *   a no-op succeeded.
 * - Revoking a key that is not currently usable -- either already revoked,
 *   or not yet active (`validFrom` still in the future) -- is accepted
 *   (`ok: true`): such a key does not count toward the currently-valid
 *   total in the first place, so revoking it cannot reduce that total, and
 *   there is nothing to reject (Requirement 10.5 only cares about the
 *   count going to zero).
 * - Revoking a currently valid key is rejected as `'would-leave-no-valid-key'`
 *   when it is the last currently-valid key in the list -- accepting it
 *   would leave the relation with no key either side can verify a
 *   signature against (Requirement 10.5, 10.6). "Currently valid" means
 *   active AND not revoked: `validFrom <= now && revokedAt == null`. A key
 *   whose `validFrom` is still in the future does not count toward this
 *   total, even though it has never been revoked -- the verifier on the
 *   other side cannot use it yet either, and design.md's 30-second clock-
 *   skew tolerance means this window is a real, expected occurrence during
 *   a rotation, not just a theoretical edge case.
 */
export const judgeKeyRevocation = (
  keys: readonly RevocableKeyEntry[],
  keyIdToRevoke: string,
  now: string,
): KeyRevocationJudgement => {
  const target = keys.find((key) => key.keyId === keyIdToRevoke);
  if (target == null) {
    return { ok: false, reason: 'unknown-key' };
  }

  // `validFrom`/`now` are compared as plain strings, so both sides must supply
  // them in the same UTC representation (`Date#toISOString()`'s output). This
  // package doesn't own that format decision -- it's set by task 3.3's
  // `PublicKeyRegistration.validFrom` and followed by whatever timestamps the
  // app/proxy sides construct before calling this function.
  const isCurrentlyValid = (key: RevocableKeyEntry): boolean =>
    key.validFrom <= now && key.revokedAt == null;

  // A key that is not currently usable -- already revoked, or not yet
  // active -- does not count toward the valid total, so revoking it
  // cannot reduce that total. Apply the same "currently valid" predicate
  // to the target key as is used for counting below, rather than only
  // checking `revokedAt` here (a not-yet-active key must be handled the
  // same way as an already-revoked one).
  if (!isCurrentlyValid(target)) {
    return { ok: true };
  }

  const remainingValid = keys.filter(
    (key) => key.keyId !== keyIdToRevoke && isCurrentlyValid(key),
  ).length;
  if (remainingValid === 0) {
    return { ok: false, reason: 'would-leave-no-valid-key' };
  }

  return { ok: true };
};
