// A signature key's identifier and the bare judgement over its shape.
//
// See design.md "鍵の識別子 -- 関係ごとに一意にする" for the full rationale.
// A hub proxy serves many GROWI instances (Requirement 8.1), and each
// GROWI's own registered keyId is a value that instance's own operator
// chooses -- nothing stops two different GROWI instances from choosing the
// same keyId. If a keyId alone could resolve a public key, a nonce record,
// or a processed-request record, one relation's lookup could resolve
// another relation's key (Requirement 10.5, 10.6). KeyRef therefore pairs
// keyId with relationId, and relationId -- assigned by the proxy at pairing
// time -- can never collide by construction.
//
// The wire form (`keyid` on the signature header) does not need a "which
// side" axis: `resolvePublicKey` is always called to look up the *other*
// party's key (design.md's `VerifyParams.resolvePublicKey` doc is explicit
// that KeyRef itself carries no side axis; each side's own storage is
// responsible for keeping "my keys" and "the peer's keys" as separate
// namespaces when it stores both in one table).

/**
 * A signature key's identifier. Unique per relation, not globally unique --
 * `keyId` alone must never be used to resolve a public key, a nonce
 * namespace, or a processed-request record.
 */
export interface KeyRef {
  readonly relationId: string;
  readonly keyId: string;
}

const SEPARATOR = ':';

/**
 * `keyId` is chosen by the counterparty (the key's owner), not by this
 * proxy/GROWI -- so its shape MUST be checked at registration time. Without
 * this check, a counterparty could register a keyId containing the wire
 * separator (`:`) and shift where `encodeKeyId`/`decodeKeyId` splits.
 */
const KEY_ID_SHAPE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const isValidKeyIdShape = (keyId: string): boolean =>
  KEY_ID_SHAPE_PATTERN.test(keyId);

/** The form `keyid` takes on the signature header (RFC 9421). */
export const encodeKeyId = (ref: KeyRef): string =>
  `${ref.relationId}${SEPARATOR}${ref.keyId}`;

/**
 * Splits at the FIRST `:`. The left side is `relationId`, the right side is
 * `keyId`. Returns null when there is no `:`, either side is empty, or the
 * right side contains another `:` (a keyId that -- despite the
 * registration-time shape check -- still tried to shift the separator).
 */
export const decodeKeyId = (encoded: string): KeyRef | null => {
  const separatorIndex = encoded.indexOf(SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const relationId = encoded.slice(0, separatorIndex);
  const keyId = encoded.slice(separatorIndex + 1);

  if (relationId.length === 0 || keyId.length === 0) {
    return null;
  }
  if (keyId.includes(SEPARATOR)) {
    return null;
  }

  return { relationId, keyId };
};
