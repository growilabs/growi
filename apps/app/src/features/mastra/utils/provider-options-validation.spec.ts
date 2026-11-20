import {
  getProviderOptionsJsonStatus,
  isProviderNamespacedObject,
  isValidProviderOptionsJson,
} from './provider-options-validation';

describe('isValidProviderOptionsJson (shared FE/BE, Req 6.2)', () => {
  it.each([
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
  ])('treats %s as valid ("no provider options")', (_label, value) => {
    expect(isValidProviderOptionsJson(value)).toBe(true);
  });

  it.each([
    ['a single-namespace object', '{"openai":{"x":1}}'],
    ['a multi-namespace object', '{"openai":{"x":1},"anthropic":{"y":2}}'],
    ['an empty object (no namespaces)', '{}'],
    ['a namespace mapping to an empty object', '{"openai":{}}'],
  ])('accepts %s', (_label, value) => {
    expect(isValidProviderOptionsJson(value)).toBe(true);
  });

  // Wrong shape: the runtime resolver ignores these, so the form/route must
  // reject them up front (otherwise the admin saves "successfully" but the
  // options are silently dropped at chat time).
  it.each([
    ['a JSON array', '[1,2,3]'],
    ['a bare number', '42'],
    ['a quoted string', '"x"'],
    ['the literal true', 'true'],
    ['the literal null', 'null'],
    ['an object whose value is a primitive', '{"temperature":0.2}'],
    ['an object whose value is an array', '{"openai":[1,2]}'],
  ])('rejects %s (parsable but not a provider-namespaced object)', (_label, value) => {
    expect(isValidProviderOptionsJson(value)).toBe(false);
  });

  it('rejects a malformed JSON string', () => {
    expect(isValidProviderOptionsJson('{ bad')).toBe(false);
  });
});

describe('isProviderNamespacedObject (shared shape predicate)', () => {
  it.each([
    ['an empty object', {}],
    ['a single namespace', { openai: { x: 1 } }],
    ['a namespace mapping to an empty object', { openai: {} }],
  ])('accepts %s', (_label, value) => {
    expect(isProviderNamespacedObject(value)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', [1, 2, 3]],
    ['a number', 42],
    ['a string', 'x'],
    ['a boolean', true],
    ['an object with a primitive value', { temperature: 0.2 }],
    ['an object with an array value', { openai: [1, 2] }],
    ['an object with a null value', { openai: null }],
  ])('rejects %s', (_label, value) => {
    expect(isProviderNamespacedObject(value)).toBe(false);
  });
});

// getProviderOptionsJsonStatus is the parse-and-classify pipeline that
// isValidProviderOptionsJson is derived from; it additionally reports why (syntax
// vs. shape) and the syntax-error location for the inline indicator.
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

  it('agrees with isValidProviderOptionsJson on the valid/invalid split', () => {
    // The derivation contract: valid iff empty or valid; every other kind invalid.
    for (const value of ['', '   ', '{}', '{"openai":{"x":1}}']) {
      expect(isValidProviderOptionsJson(value)).toBe(true);
    }
    for (const value of ['42', '[1,2]', '{"openai":1}', '{ bad']) {
      expect(isValidProviderOptionsJson(value)).toBe(false);
    }
  });
});
