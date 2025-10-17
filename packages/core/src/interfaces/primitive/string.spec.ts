import { describe, expect, it } from 'vitest';

import {
  isNonBlankString,
  isNonEmptyString,
  toNonBlankString,
  toNonBlankStringOrUndefined,
  toNonEmptyString,
  toNonEmptyStringOrUndefined,
} from './string';

describe('isNonEmptyString', () => {
  /* eslint-disable indent */
  it.each`
    input        | expected | description
    ${'hello'}   | ${true}  | ${'non-empty string'}
    ${'world'}   | ${true}  | ${'non-empty string'}
    ${'a'}       | ${true}  | ${'single character'}
    ${'1'}       | ${true}  | ${'numeric string'}
    ${' '}       | ${true}  | ${'space character'}
    ${'   '}     | ${true}  | ${'multiple spaces'}
    ${''}        | ${false} | ${'empty string'}
    ${null}      | ${false} | ${'null'}
    ${undefined} | ${false} | ${'undefined'}
  `(
    'should return $expected for $description: $input',
    ({ input, expected }) => {
      /* eslint-enable indent */
      expect(isNonEmptyString(input)).toBe(expected);
    },
  );
});

describe('isNonBlankString', () => {
  /* eslint-disable indent */
  it.each`
    input        | expected | description
    ${'hello'}   | ${true}  | ${'non-blank string'}
    ${'world'}   | ${true}  | ${'non-blank string'}
    ${'a'}       | ${true}  | ${'single character'}
    ${'1'}       | ${true}  | ${'numeric string'}
    ${' '}       | ${false} | ${'space character'}
    ${'   '}     | ${false} | ${'multiple spaces'}
    ${'\t'}      | ${false} | ${'tab character'}
    ${'\n'}      | ${false} | ${'newline character'}
    ${''}        | ${false} | ${'empty string'}
    ${null}      | ${false} | ${'null'}
    ${undefined} | ${false} | ${'undefined'}
  `(
    'should return $expected for $description: $input',
    ({ input, expected }) => {
      /* eslint-enable indent */
      expect(isNonBlankString(input)).toBe(expected);
    },
  );
});

describe('toNonEmptyStringOrUndefined', () => {
  /* eslint-disable indent */
  it.each`
    input        | expected     | description
    ${'hello'}   | ${'hello'}   | ${'non-empty string'}
    ${'world'}   | ${'world'}   | ${'non-empty string'}
    ${'a'}       | ${'a'}       | ${'single character'}
    ${'1'}       | ${'1'}       | ${'numeric string'}
    ${' '}       | ${' '}       | ${'space character'}
    ${'   '}     | ${'   '}     | ${'multiple spaces'}
    ${''}        | ${undefined} | ${'empty string'}
    ${null}      | ${undefined} | ${'null'}
    ${undefined} | ${undefined} | ${'undefined'}
  `(
    'should return $expected for $description: $input',
    ({ input, expected }) => {
      /* eslint-enable indent */
      expect(toNonEmptyStringOrUndefined(input)).toBe(expected);
    },
  );
});

describe('toNonBlankStringOrUndefined', () => {
  /* eslint-disable indent */
  it.each`
    input        | expected     | description
    ${'hello'}   | ${'hello'}   | ${'non-blank string'}
    ${'world'}   | ${'world'}   | ${'non-blank string'}
    ${'a'}       | ${'a'}       | ${'single character'}
    ${'1'}       | ${'1'}       | ${'numeric string'}
    ${' '}       | ${undefined} | ${'space character'}
    ${'   '}     | ${undefined} | ${'multiple spaces'}
    ${'\t'}      | ${undefined} | ${'tab character'}
    ${'\n'}      | ${undefined} | ${'newline character'}
    ${''}        | ${undefined} | ${'empty string'}
    ${null}      | ${undefined} | ${'null'}
    ${undefined} | ${undefined} | ${'undefined'}
  `(
    'should return $expected for $description: $input',
    ({ input, expected }) => {
      /* eslint-enable indent */
      expect(toNonBlankStringOrUndefined(input)).toBe(expected);
    },
  );
});

describe('toNonEmptyString', () => {
  /* eslint-disable indent */
  it.each`
    input      | expected   | description
    ${'hello'} | ${'hello'} | ${'non-empty string'}
    ${'world'} | ${'world'} | ${'non-empty string'}
    ${'a'}     | ${'a'}     | ${'single character'}
    ${'1'}     | ${'1'}     | ${'numeric string'}
    ${' '}     | ${' '}     | ${'space character'}
    ${'   '}   | ${'   '}   | ${'multiple spaces'}
  `(
    'should return $expected for valid $description: $input',
    ({ input, expected }) => {
      /* eslint-enable indent */
      expect(toNonEmptyString(input)).toBe(expected);
    },
  );

  /* eslint-disable indent */
  it.each`
    input        | description
    ${''}        | ${'empty string'}
    ${null}      | ${'null'}
    ${undefined} | ${'undefined'}
  `('should throw error for invalid $description: $input', ({ input }) => {
    /* eslint-enable indent */
    expect(() => toNonEmptyString(input)).toThrow(
      'Expected a non-empty string, but received:',
    );
  });
});

describe('toNonBlankString', () => {
  /* eslint-disable indent */
  it.each`
    input      | expected   | description
    ${'hello'} | ${'hello'} | ${'non-blank string'}
    ${'world'} | ${'world'} | ${'non-blank string'}
    ${'a'}     | ${'a'}     | ${'single character'}
    ${'1'}     | ${'1'}     | ${'numeric string'}
  `(
    'should return $expected for valid $description: $input',
    ({ input, expected }) => {
      /* eslint-enable indent */
      expect(toNonBlankString(input)).toBe(expected);
    },
  );

  /* eslint-disable indent */
  it.each`
    input        | description
    ${' '}       | ${'space character'}
    ${'   '}     | ${'multiple spaces'}
    ${'\t'}      | ${'tab character'}
    ${'\n'}      | ${'newline character'}
    ${''}        | ${'empty string'}
    ${null}      | ${'null'}
    ${undefined} | ${'undefined'}
  `('should throw error for invalid $description: $input', ({ input }) => {
    /* eslint-enable indent */
    expect(() => toNonBlankString(input)).toThrow(
      'Expected a non-blank string, but received:',
    );
  });
});

describe('type safety', () => {
  it('should maintain type safety with branded types', () => {
    const validString = 'test';

    const nonEmptyResult = toNonEmptyStringOrUndefined(validString);
    const nonBlankResult = toNonBlankStringOrUndefined(validString);

    expect(nonEmptyResult).toBe(validString);
    expect(nonBlankResult).toBe(validString);

    // These types should be different at compile time
    // but we can't easily test that in runtime
    if (nonEmptyResult !== undefined && nonBlankResult !== undefined) {
      expect(nonEmptyResult).toBe(nonBlankResult);
    }
  });
});
