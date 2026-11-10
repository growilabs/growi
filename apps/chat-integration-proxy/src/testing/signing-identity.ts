// One side's Ed25519 signing key, for the end-to-end harness.
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE. Nothing under `src/testing/` is
// re-exported from `src/index.ts`, and `tsconfig.build.json` keeps the whole
// directory out of `dist/`, so no shipped code can reach it.
//
// The split between `privateKey` and `asPeerKey` is the point of this file: the
// side that SIGNS holds the whole identity, and the side that VERIFIES is given
// `asPeerKey` alone. A harness that handed both halves across would let a test
// pass while the two sides shared one value rather than agreeing about two.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { KeyRef } from '@growi/chat/server';

/** What a verifying side stores about a peer: which key, and its public half. */
export interface PeerKey {
  readonly key: KeyRef;
  readonly publicKey: KeyObject;
}

export interface SigningIdentity extends PeerKey {
  readonly privateKey: KeyObject;
  /** The public half alone, to hand to whoever verifies this side. */
  readonly asPeerKey: PeerKey;
}

/**
 * `keyId` is shaped to pass `isValidKeyIdShape` (`/^[A-Za-z0-9_-]{8,64}$/`),
 * which every registration path checks -- a harness key that could not be
 * registered would be a harness that cannot exercise key rotation.
 */
export const createSigningIdentity = (
  relationId: string,
  keyId: string,
): SigningIdentity => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key: KeyRef = { relationId, keyId };
  return { key, publicKey, privateKey, asPeerKey: { key, publicKey } };
};
