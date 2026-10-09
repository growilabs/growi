// `Content-Digest` (RFC 9530) over the request body.
//
// The digest is what lets the receiving side confirm the body did not change
// in transit (requirement 10.1): the header value itself is one of the
// covered components of the RFC 9421 signature, so covering the digest covers
// the body without the signature base string having to carry the body.

import { createHash } from 'node:crypto';

import { serializeByteSequenceDictionary } from './structured-fields.js';

/** `Content-Digest` (RFC 9530) hashing algorithm. THE single place this is declared. */
export const CONTENT_DIGEST_ALGORITHM = 'sha-512' as const;

/** The `node:crypto` spelling of {@link CONTENT_DIGEST_ALGORITHM}. */
const NODE_HASH_ALGORITHM = 'sha512';

/**
 * Builds the `Content-Digest` header value for the body bytes.
 *
 * Takes the bytes that are actually sent -- never a re-serialized object --
 * so that the digest matches what the peer hashes on arrival.
 */
export const computeContentDigest = (body: Uint8Array): string => {
  const digest = createHash(NODE_HASH_ALGORITHM).update(body).digest();
  return serializeByteSequenceDictionary(
    new Map([[CONTENT_DIGEST_ALGORITHM, digest]]),
  );
};
