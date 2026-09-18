// Producing an RFC 9421 signature over an outgoing request.
//
// The private key is a parameter of this function and never leaves it: it is
// not returned, not put on the result, and not written anywhere
// (requirement 9.6, 10.6).

import { type KeyObject, sign as nodeSign, randomBytes } from 'node:crypto';

import { computeContentDigest } from './content-digest.js';
import { COVERED_COMPONENTS } from './covered-components.js';
import { encodeKeyId, type KeyRef } from './key-identity.js';
import {
  buildSignatureBase,
  type SignatureParamValue,
} from './signature-base.js';
import { SIGNATURE_ALGORITHM, SIGNATURE_PARAMS } from './signature-params.js';
import {
  serializeByteSequenceDictionary,
  serializeStringInnerList,
} from './structured-fields.js';

/**
 * The label the single signature of a request is filed under. RFC 9421 allows
 * several signatures per request; this package always sends exactly one.
 */
export const SIGNATURE_LABEL = 'sig1';

/**
 * The validity period to ask for unless there is a reason to differ
 * (design.md `SignParams.expiresInSec`). The receiving side caps whatever it
 * is handed at `MAX_ACCEPTED_EXPIRES_IN_SEC` regardless.
 */
export const DEFAULT_EXPIRES_IN_SEC = 60;

/** How many bytes of randomness a generated nonce carries. */
const NONCE_BYTES = 16;

export interface SignParams {
  /** Always `'POST'` -- every signed request in this protocol carries a body. */
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The bytes that will actually be sent -- never a re-serialized object, or
   * the digest will not match what the peer hashes on arrival.
   */
  readonly body: Uint8Array;
  readonly key: KeyRef;
  readonly privateKey: KeyObject;
  /** See {@link DEFAULT_EXPIRES_IN_SEC}. */
  readonly expiresInSec: number;
  /** Generated when omitted. */
  readonly nonce?: string;
}

export interface SignResult {
  readonly headers: {
    readonly 'content-digest': string;
    /** `keyid` / `created` / `expires` / `nonce` / `alg` travel in here. */
    readonly 'signature-input': string;
    readonly signature: string;
  };
  readonly nonce: string;
  readonly expiresAt: Date;
}

/**
 * Signs a request and returns the three headers to send with it.
 *
 * @throws if `privateKey` is not an Ed25519 private key, or `expiresInSec` is
 * not a positive whole number of seconds. Both are local programming mistakes
 * on the sending side -- unlike `verify`, which answers to the network and so
 * reports failures as values instead.
 */
export const sign = (params: SignParams): SignResult => {
  const { method, headers, body, key, privateKey, expiresInSec } = params;

  if (
    privateKey.type !== 'private' ||
    privateKey.asymmetricKeyType !== SIGNATURE_ALGORITHM
  ) {
    throw new Error(
      `Cannot sign: an Ed25519 private key is required, got ${privateKey.type}/${
        privateKey.asymmetricKeyType ?? 'unknown'
      }`,
    );
  }
  if (!Number.isInteger(expiresInSec) || expiresInSec <= 0) {
    throw new RangeError(
      `Cannot sign: expiresInSec must be a positive whole number of seconds, got ${expiresInSec}`,
    );
  }

  const nonce = params.nonce ?? randomBytes(NONCE_BYTES).toString('base64url');
  const createdSec = Math.floor(Date.now() / 1000);
  const expiresSec = createdSec + expiresInSec;
  const contentDigest = computeContentDigest(body);

  const values: Record<string, SignatureParamValue> = {
    created: createdSec,
    expires: expiresSec,
    nonce,
    keyid: encodeKeyId(key),
    alg: SIGNATURE_ALGORITHM,
  };
  // Built from the declaration rather than written out again, so a parameter
  // added there cannot be silently left out of the header.
  const signatureParams = new Map<string, SignatureParamValue>(
    SIGNATURE_PARAMS.map((name) => [name, values[name]]),
  );

  const signatureBase = buildSignatureBase(
    COVERED_COMPONENTS,
    { method, headers: { ...headers, 'content-digest': contentDigest } },
    signatureParams,
  );
  const signature = nodeSign(
    null,
    Buffer.from(signatureBase, 'utf8'),
    privateKey,
  );

  return {
    headers: {
      'content-digest': contentDigest,
      'signature-input': `${SIGNATURE_LABEL}=${serializeStringInnerList(
        [...COVERED_COMPONENTS],
        signatureParams,
      )}`,
      signature: serializeByteSequenceDictionary(
        new Map([[SIGNATURE_LABEL, signature]]),
      ),
    },
    nonce,
    expiresAt: new Date(expiresSec * 1000),
  };
};
