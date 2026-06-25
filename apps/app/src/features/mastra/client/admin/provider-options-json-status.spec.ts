import { describe, expect, it } from 'vitest';

import { getProviderOptionsJsonStatus } from './provider-options-json-status';

describe('getProviderOptionsJsonStatus', () => {
  it('reports an empty/whitespace value as empty (no options set)', () => {
    expect(getProviderOptionsJsonStatus('')).toEqual({ kind: 'empty' });
    expect(getProviderOptionsJsonStatus('   \n  ')).toEqual({ kind: 'empty' });
  });

  it('reports a provider-namespaced object as valid', () => {
    expect(
      getProviderOptionsJsonStatus('{"openai":{"reasoningEffort":"low"}}'),
    ).toEqual({ kind: 'valid' });
    // `{}` (no namespaces) is vacuously valid.
    expect(getProviderOptionsJsonStatus('{}')).toEqual({ kind: 'valid' });
  });

  it('reports well-formed JSON of the wrong shape as a shape error', () => {
    // A bare primitive, an array, and an object whose value is not itself an
    // options object are all parseable but not provider-namespaced.
    expect(getProviderOptionsJsonStatus('42')).toEqual({ kind: 'shape-error' });
    expect(getProviderOptionsJsonStatus('[1,2]')).toEqual({
      kind: 'shape-error',
    });
    expect(getProviderOptionsJsonStatus('{"openai":1}')).toEqual({
      kind: 'shape-error',
    });
  });

  it('reports malformed JSON as a syntax error and locates the line', () => {
    const status = getProviderOptionsJsonStatus('{ invalid json');
    expect(status).toEqual({ kind: 'syntax-error', line: 1, column: 3 });
  });

  it('locates the line of a syntax error in multi-line input', () => {
    const status = getProviderOptionsJsonStatus('{\n  bad');
    // The error is on the second line; the indicator must point there, not at
    // the top of the textarea.
    expect(status.kind).toBe('syntax-error');
    if (status.kind === 'syntax-error') {
      expect(status.line).toBe(2);
    }
  });
});
