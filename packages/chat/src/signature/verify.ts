// Checking an RFC 9421 signature on an incoming request.
//
// **This function never throws.** Every rejection -- a header that does not
// parse, a key that cannot be resolved, a store that cannot answer -- comes
// back as a failure value, because the receiving side has to record why a
// request was refused (requirement 10.2), and an exception escaping into an
// HTTP handler would turn that into an unexplained 500.

import {
  type KeyObject,
  verify as nodeVerify,
  timingSafeEqual,
} from 'node:crypto';

import {
  CONTENT_DIGEST_ALGORITHM,
  computeContentDigest,
} from './content-digest.js';
import { COVERED_COMPONENTS } from './covered-components.js';
import { decodeKeyId, type KeyRef } from './key-identity.js';
import { buildSignatureBase } from './signature-base.js';
import { SIGNATURE_ALGORITHM, SIGNATURE_PARAMS } from './signature-params.js';
import {
  parseByteSequenceDictionary,
  parseStringInnerListDictionary,
} from './structured-fields.js';

/**
 * The longest validity period the receiving side accepts, however long the
 * sender declared. `expires` is the sender's value, so taking it as sent lets
 * one request declare itself valid for years (design.md `MessageSignature`
 * Invariants, requirement 10.3).
 */
export const MAX_ACCEPTED_EXPIRES_IN_SEC = 300;

/**
 * How far the two sides' clocks may differ. Applied to `created` only: the
 * instant that ends acceptance is also the instant handed to `consumeNonce`,
 * so widening one without the other would leave a window in which the nonce
 * record may already be gone while the request is still accepted -- a replay
 * would pass (requirement 10.4).
 */
export const CLOCK_SKEW_TOLERANCE_SEC = 30;

export type VerifyFailure =
  | 'signature-mismatch'
  | 'digest-mismatch'
  | 'expired'
  | 'replayed'
  | 'unknown-key'
  | 'malformed';

export type VerifyResult =
  | { readonly ok: true; readonly key: KeyRef }
  | { readonly ok: false; readonly failure: VerifyFailure };

export interface VerifyParams {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The bytes as received. Never bytes rebuilt from a parsed value -- the key
   * order and number formatting are not guaranteed to match what the sender
   * sent, which would reject a legitimate peer.
   */
  readonly body: Uint8Array;
  /**
   * Resolves the public key a `KeyRef` stands for, or `null` when there is
   * none to use.
   *
   * **Returns `null` for a revoked key and for one that is not active yet**
   * (`validFrom` in the future): leaving that judgement to each caller means
   * one side forgetting it makes revocation quietly stop working
   * (requirement 10.5, 10.6).
   *
   * **Returns the peer's key only, never the caller's own.** Both sides keep
   * their own keys and the peer's in one table, so an implementation that
   * does not filter by side is easy to write by accident -- and without that
   * filter, a key-registration request the caller signed with its own key can
   * be sent back to its own endpoint, registering an attacker's key as the
   * peer's. `KeyRef` carries no side axis, so the side wiring this function up
   * is what guarantees "peer only".
   */
  readonly resolvePublicKey: (ref: KeyRef) => Promise<KeyObject | null>;
  /**
   * Returns `false` the second time the same value is used (requirement
   * 10.4). Called only after the signature has been checked.
   */
  readonly consumeNonce: (
    ref: KeyRef,
    nonce: string,
    expiresAt: Date,
  ) => Promise<boolean>;
}

const failWith = (failure: VerifyFailure): VerifyResult => ({
  ok: false,
  failure,
});

const findHeader = (
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined => {
  // Header names are case-insensitive, and what reaches this function depends
  // on whichever HTTP layer parsed the request.
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return value;
    }
  }
  return undefined;
};

const integerParam = (
  parameters: ReadonlyMap<string, number | string>,
  name: string,
): number | null => {
  const value = parameters.get(name);
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
};

const stringParam = (
  parameters: ReadonlyMap<string, number | string>,
  name: string,
): string | null => {
  const value = parameters.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const digestBytesOf = (headerValue: string): Uint8Array | null =>
  parseByteSequenceDictionary(headerValue)?.get(CONTENT_DIGEST_ALGORITHM) ??
  null;

const verifyRequest = async (params: VerifyParams): Promise<VerifyResult> => {
  const { method, headers, body, resolvePublicKey, consumeNonce } = params;

  const signatureInputHeader = findHeader(headers, 'signature-input');
  const signatureHeader = findHeader(headers, 'signature');
  const contentDigestHeader = findHeader(headers, 'content-digest');
  if (
    signatureInputHeader == null ||
    signatureHeader == null ||
    contentDigestHeader == null
  ) {
    return failWith('malformed');
  }

  const signatureInputs = parseStringInnerListDictionary(signatureInputHeader);
  // This package always sends exactly one signature; more than one would
  // leave "which one was checked" for the caller to guess.
  if (signatureInputs == null || signatureInputs.size !== 1) {
    return failWith('malformed');
  }
  const [label, signatureInput] = [...signatureInputs][0];

  const signatureBytes =
    parseByteSequenceDictionary(signatureHeader)?.get(label) ?? null;
  if (signatureBytes == null) {
    return failWith('malformed');
  }

  // The covered components are fixed for this protocol. Rebuilding the base
  // from a different list -- even a valid RFC 9421 one -- would mean checking
  // a signature over less than the request is supposed to commit to.
  if (
    signatureInput.members.length !== COVERED_COMPONENTS.length ||
    signatureInput.members.some(
      (member, index) => member !== COVERED_COMPONENTS[index],
    )
  ) {
    return failWith('malformed');
  }

  const { parameters } = signatureInput;
  // RFC 9421 lets `expires` and `nonce` be left out. Accepting a signature
  // without them would make the validity cap and the replay guard meaningless
  // (requirement 10.3, 10.4), so every declared parameter is required. Driven
  // by the declaration rather than written out again, so a parameter added
  // there cannot quietly become optional here.
  for (const name of SIGNATURE_PARAMS) {
    if (!parameters.has(name)) {
      return failWith('malformed');
    }
  }

  const created = integerParam(parameters, 'created');
  const expires = integerParam(parameters, 'expires');
  const nonce = stringParam(parameters, 'nonce');
  const keyId = stringParam(parameters, 'keyid');
  const declaredAlg = stringParam(parameters, 'alg');
  // Present, but not of the shape the guards need (a `created` that is not a
  // whole number of seconds, an empty `nonce`).
  if (
    created == null ||
    expires == null ||
    nonce == null ||
    keyId == null ||
    declaredAlg == null
  ) {
    return failWith('malformed');
  }

  const key = decodeKeyId(keyId);
  if (key == null) {
    return failWith('malformed');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Without this, a sender puts `created` far in the future and the cap below
  // stops meaning anything.
  if (created > nowSec + CLOCK_SKEW_TOLERANCE_SEC) {
    return failWith('expired');
  }
  const effectiveExpiresSec = Math.min(
    expires,
    created + MAX_ACCEPTED_EXPIRES_IN_SEC,
  );
  if (nowSec > effectiveExpiresSec) {
    return failWith('expired');
  }

  let publicKey: KeyObject | null;
  try {
    publicKey = await resolvePublicKey(key);
  } catch {
    // A key store that cannot answer must not let the request through.
    return failWith('unknown-key');
  }
  if (
    publicKey == null ||
    publicKey.type !== 'public' ||
    publicKey.asymmetricKeyType !== SIGNATURE_ALGORITHM
  ) {
    // Either there is no key for this reference (unknown, revoked, or not
    // active yet), or what came back cannot verify a signature of this
    // protocol -- a private key handed back by a `resolvePublicKey` that does
    // not filter by side lands here too.
    return failWith('unknown-key');
  }

  // The scheme comes from the stored key; the `alg` the request declares is
  // only compared against it, never used to pick a primitive. Comparing here,
  // before anything cryptographic runs, is also why the answer is `malformed`
  // rather than `signature-mismatch`: no signature was checked.
  if (declaredAlg !== publicKey.asymmetricKeyType) {
    return failWith('malformed');
  }

  let signatureBase: string;
  try {
    // Both the component list and the parameters go back in exactly as they
    // arrived -- including any parameter this package does not know about and
    // the order they were sent in (RFC 9421 section 3.2 step 7).
    signatureBase = buildSignatureBase(
      signatureInput.members,
      { method, headers },
      parameters,
    );
  } catch {
    // A covered component the request does not carry: nothing to check.
    return failWith('malformed');
  }

  // `crypto.verify` answers `false` for a signature of any wrong length -- it
  // only throws when handed something that is not bytes, which the parser
  // above has already ruled out.
  const signatureMatches = nodeVerify(
    null,
    Buffer.from(signatureBase, 'utf8'),
    publicKey,
    signatureBytes,
  );
  if (!signatureMatches) {
    return failWith('signature-mismatch');
  }

  // The signature covers the *value* of the `content-digest` header, not the
  // body. Nothing so far ties that value to the bytes that actually arrived,
  // so the digest has to be recomputed here (requirement 10.1). Recomputing
  // through `computeContentDigest` keeps the hash algorithm declared in one
  // place.
  const receivedDigest = digestBytesOf(contentDigestHeader);
  const expectedDigest = digestBytesOf(computeContentDigest(body));
  if (receivedDigest == null || expectedDigest == null) {
    return failWith('malformed');
  }
  if (
    receivedDigest.length !== expectedDigest.length ||
    !timingSafeEqual(receivedDigest, expectedDigest)
  ) {
    return failWith('digest-mismatch');
  }

  let nonceAccepted: boolean;
  try {
    // The expiry handed over is the receiver's capped one, never the one that
    // was sent: with the sender's value the nonce table would keep records
    // that never fall due and grow without bound.
    nonceAccepted = await consumeNonce(
      key,
      nonce,
      new Date(effectiveExpiresSec * 1000),
    );
  } catch {
    // A nonce store that cannot answer cannot rule out a replay.
    return failWith('replayed');
  }
  if (!nonceAccepted) {
    return failWith('replayed');
  }

  return { ok: true, key };
};

/**
 * Checks the RFC 9421 signature on a request and reports whose key signed it.
 *
 * The one-time value is consumed only once everything else has passed: doing
 * it earlier would let anyone who merely knows a key identifier fill the nonce
 * store.
 */
export const verify = async (params: VerifyParams): Promise<VerifyResult> => {
  try {
    return await verifyRequest(params);
  } catch {
    return failWith('malformed');
  }
};
