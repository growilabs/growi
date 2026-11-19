import { resolveEnvVarType } from './resolve-env-var-type';

describe('resolveEnvVarType', () => {
  it.each([
    ['an undefined default', undefined],
    ['a default of a different type', 8000],
  ])('uses the declared envVarType over %s', (_, defaultValue) => {
    expect(resolveEnvVarType('k', { envVarType: 'string', defaultValue })).toBe(
      'string',
    );
  });

  it.each([
    ['a string', 'en_US', 'string'],
    ['a number', 8000, 'number'],
    ['Infinity', Infinity, 'number'],
    ['a boolean', false, 'boolean'],
    ['an object', { a: 1 }, 'object'],
    ['an array', [], 'object'],
  ])('infers the type from %s default', (_, defaultValue, expected) => {
    expect(resolveEnvVarType('k', { defaultValue })).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['bigint', 10n],
    ['symbol', Symbol('lru')],
    ['function', () => 30],
  ])('throws naming the config for a %s default without envVarType', (_, defaultValue) => {
    const resolve = () =>
      resolveEnvVarType('app:example', {
        envVarName: 'EXAMPLE',
        defaultValue,
      });

    expect(resolve).toThrow('EXAMPLE');
    expect(resolve).toThrow("'app:example'");
  });
});
