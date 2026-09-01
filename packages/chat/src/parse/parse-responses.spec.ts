import { describe, expect, it } from 'vitest';

import { parseKeyOperationResult } from './parse-responses.js';

describe('parseKeyOperationResult', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseKeyOperationResult(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid ok result', () => {
    expect(parseKeyOperationResult({ status: 'ok' })).toEqual({
      status: 'ok',
    });
  });

  it.each([
    'would-leave-no-valid-key',
    'unknown-key',
    'invalid-key',
  ])('accepts every real rejection reason: %s', (reason) => {
    expect(parseKeyOperationResult({ status: 'rejected', reason })).toEqual({
      status: 'rejected',
      reason,
    });
  });

  it('rejects when status is missing', () => {
    expect(parseKeyOperationResult({})).toEqual({ error: 'malformed' });
  });

  it('rejects an unrecognized status value', () => {
    expect(parseKeyOperationResult({ status: 'maybe' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a rejected result missing reason', () => {
    expect(parseKeyOperationResult({ status: 'rejected' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a rejected result with an unrecognized reason', () => {
    expect(
      parseKeyOperationResult({ status: 'rejected', reason: 'no-idea' }),
    ).toEqual({ error: 'malformed' });
  });
});
