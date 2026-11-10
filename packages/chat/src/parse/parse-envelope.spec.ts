import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import { parseOpEnvelope } from './parse-envelope.js';

const ALLOWED_OPS: ReadonlyArray<string> = [
  'capabilities',
  'connection-status',
  'channels',
  'settings-pull',
];

describe('parseOpEnvelope', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseOpEnvelope(value)).toEqual({ error: 'malformed' });
    });
  });

  it.each([
    'capabilities',
    'connection-status',
    'channels',
    'settings-pull',
  ])('accepts op %s and retains relationId/op', (op) => {
    const valid = { relationId: 'rel-1', op };
    const result = parseOpEnvelope(valid);
    expect(result).toEqual(valid);
    if (!('error' in result)) {
      expect(result.relationId).toBe('rel-1');
      expect(result.op).toBe(op);
    }
  });

  it('rejects when relationId is missing', () => {
    expect(parseOpEnvelope({ op: 'capabilities' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects when op is missing', () => {
    expect(parseOpEnvelope({ relationId: 'rel-1' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that is not a real OP_NAMES member', () => {
    expect(parseOpEnvelope({ relationId: 'rel-1', op: 'nope' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that IS a real OP_NAMES member but not one of the 4 read-only ops', () => {
    expect(parseOpEnvelope({ relationId: 'rel-1', op: 'command' })).toEqual({
      error: 'malformed',
    });
    expect(
      parseOpEnvelope({ relationId: 'rel-1', op: 'notification' }),
    ).toEqual({
      error: 'malformed',
    });
  });

  it.each(
    Object.values(OP_NAMES).filter((op) => !ALLOWED_OPS.includes(op)),
  )('rejects every other real OP_NAMES member: %s', (op) => {
    expect(parseOpEnvelope({ relationId: 'rel-1', op })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a wrong-typed relationId', () => {
    expect(parseOpEnvelope({ relationId: 123, op: 'capabilities' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an oversized relationId', () => {
    expect(
      parseOpEnvelope({ relationId: 'x'.repeat(1000), op: 'capabilities' }),
    ).toEqual({ error: 'malformed' });
  });
});
