// Confirms the wire shape of the key add/revoke round trip (Requirement
// 10.5, 10.6), which flows both directions (proxy -> GROWI and GROWI ->
// proxy -- see `KeyRegistrationRequest`/`KeyRevocationRequest`'s `op` union
// in `contract/pairing.ts`). See parse-command.ts's header comment for why
// every parse* function here re-checks shape even though the body already
// passed signature verification.
//
// Public-key material judgement is NOT re-derived here: `isValidKeyIdShape`
// and `isValidPublicKeyMaterial` (task 2.4, `signature/key-identity.ts` /
// `signature/key-material.ts`) already own that logic, and this file only
// calls through to it.

import type {
  KeyRegistrationRequest,
  KeyRevocationRequest,
} from '../contract/pairing.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { isValidKeyIdShape } from '../signature/key-identity.js';
import { isValidPublicKeyMaterial } from '../signature/key-material.js';
import { isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;
/**
 * `str`'s max here only needs to be >= `isValidKeyIdShape`'s own upper
 * bound (64, `KEY_ID_SHAPE_PATTERN` in `signature/key-identity.ts`) -- that
 * function is the real authority on keyId's shape, this is just a
 * defensive outer bound before handing the value to it.
 */
const KEY_ID_MAX = 128;
/** ISO-8601 timestamp (`Date#toISOString()`, see tasks.md's 4.3 Implementation Note). */
const VALID_FROM_MAX = 64;

type ParseError = { readonly error: 'malformed' };

export const parseKeyRegistration = (
  raw: unknown,
): KeyRegistrationRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  // Flows both directions, so both allowed ops are accepted here -- but
  // nothing else (this is still an exact 2-member allow-list, not "any
  // OP_NAMES member").
  const op = oneOf(raw.op, [
    OP_NAMES.keyRegisterToGrowi,
    OP_NAMES.keyRegisterToProxy,
  ]);
  const keyRaw = raw.key;

  if (relationId === undefined || op === undefined || !isRecord(keyRaw)) {
    return { error: 'malformed' };
  }

  const keyId = str(keyRaw.keyId, KEY_ID_MAX);
  const validFrom = str(keyRaw.validFrom, VALID_FROM_MAX);
  const publicKeyJwk = keyRaw.publicKeyJwk;

  if (
    keyId === undefined ||
    validFrom === undefined ||
    !isRecord(publicKeyJwk) ||
    !isValidKeyIdShape(keyId) ||
    !isValidPublicKeyMaterial(publicKeyJwk).ok
  ) {
    return { error: 'malformed' };
  }

  return {
    relationId,
    op,
    key: { keyId, publicKeyJwk, validFrom },
  };
};

export const parseKeyRevocation = (
  raw: unknown,
): KeyRevocationRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, [
    OP_NAMES.keyRevokeToGrowi,
    OP_NAMES.keyRevokeToProxy,
  ]);
  const keyId = str(raw.keyId, KEY_ID_MAX);

  if (
    relationId === undefined ||
    op === undefined ||
    keyId === undefined ||
    !isValidKeyIdShape(keyId)
  ) {
    return { error: 'malformed' };
  }

  return { relationId, op, keyId };
};
