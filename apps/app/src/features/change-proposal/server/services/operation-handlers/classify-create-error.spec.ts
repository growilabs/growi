import { classifyCreateError } from './classify-create-error';

describe('classifyCreateError', () => {
  // The messages below are the ones pageService.create and pageGrantService throw today.
  it.each([
    'The selected grant or grantedGroup is not assignable to this page.',
    'The user does not belong to any of the granted groups',
    'grantedGroups must not be empty for GRANT_USER_GROUP',
    'The grant of the users top page must be public.',
  ])('classifies "%s" as grant-not-assignable', (message) => {
    expect(classifyCreateError(new Error(message))).toBe(
      'grant-not-assignable',
    );
  });

  it('classifies the generic refusal of canProcessCreate as not-processable', () => {
    expect(classifyCreateError(new Error('Cannot process create'))).toBe(
      'not-processable',
    );
  });

  it.each([
    new Error('connection reset'),
    'a thrown string',
    undefined,
  ])('classifies anything else (%s) as unknown', (err) => {
    expect(classifyCreateError(err)).toBe('unknown');
  });
});
