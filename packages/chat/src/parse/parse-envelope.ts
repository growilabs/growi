// Confirms the wire shape of the 3 read-only ops' body and settings-pull's
// body (`OpOnlyRequest` -- design.md's callout box directly above the
// parse* signatures). All 4 ops share the same body shape: the envelope
// itself, with no op-specific fields. See parse-command.ts's header
// comment for why every parse* function here re-checks shape even though
// the body already passed signature verification.

import { OP_NAMES, type OpOnlyRequest } from '../endpoints/op-names.js';
import { isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;

const ALLOWED_OPS: ReadonlyArray<OpOnlyRequest['op']> = [
  OP_NAMES.capabilities,
  OP_NAMES.connectionStatus,
  OP_NAMES.channels,
  OP_NAMES.settingsPull,
];

type ParseError = { readonly error: 'malformed' };

export const parseOpEnvelope = (raw: unknown): OpOnlyRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, ALLOWED_OPS);

  if (relationId === undefined || op === undefined) {
    return { error: 'malformed' };
  }

  return { relationId, op };
};
