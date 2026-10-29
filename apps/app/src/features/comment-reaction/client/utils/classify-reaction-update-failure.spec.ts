import { ErrorV3 } from '@growi/core/dist/models';
import { describe, expect, it } from 'vitest';

import { classifyReactionUpdateFailure } from './classify-reaction-update-failure';

describe('classifyReactionUpdateFailure', () => {
  it.each([
    ['reaction-kind-limit-exceeded', 'kind-limit-exceeded'],
    ['notfound_or_forbidden', 'comment-unavailable'],
    ['validation_failed', 'failed'],
    ['invalid-reaction-emoji', 'failed'],
  ])('classifies ErrorV3 code %s as %s', (code, expected) => {
    expect(classifyReactionUpdateFailure([new ErrorV3('msg', code)])).toBe(
      expected,
    );
  });

  it('classifies a plain JSON error object, as thrown by apiv3-client', () => {
    expect(
      classifyReactionUpdateFailure([{ code: 'reaction-kind-limit-exceeded' }]),
    ).toBe('kind-limit-exceeded');
  });

  it('classifies an ErrorV3 without a code as failed', () => {
    expect(classifyReactionUpdateFailure([new ErrorV3('msg')])).toBe('failed');
  });

  it.each([
    ['an empty array (network failure or body-less 403)', []],
    ['a non-array Error', new Error('Network Error')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['an array of non-error values', [null, 42]],
  ])('classifies %s as failed', (_label, input) => {
    expect(classifyReactionUpdateFailure(input)).toBe('failed');
  });
});
