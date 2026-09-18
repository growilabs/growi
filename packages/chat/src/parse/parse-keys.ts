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
import { parsePublicKeyRegistration } from './common-fields.js';
import { isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;
/**
 * `str`'s max here only needs to be >= `isValidKeyIdShape`'s own upper
 * bound (64, `KEY_ID_SHAPE_PATTERN` in `signature/key-identity.ts`) -- that
 * function is the real authority on keyId's shape, this is just a
 * defensive outer bound before handing the value to it.
 */
const KEY_ID_MAX = 128;

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
  // Shared with parse-pairing.ts's parsePairingSubmission and
  // parse-responses.ts's parsePairingResult -- see common-fields.ts's doc
  // comment on parsePublicKeyRegistration (tasks.md's 6.3->6.5 Implementation Note).
  const key = parsePublicKeyRegistration(raw.key);

  if (relationId === undefined || op === undefined || key === undefined) {
    return { error: 'malformed' };
  }

  return { relationId, op, key };
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
