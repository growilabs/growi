export type CreateErrorKind =
  | 'grant-not-assignable'
  | 'not-processable'
  | 'unknown';

// pageService.create reports these only as plain Error messages. create.integ.ts
// classifies the errors the real pageService.create throws, so a reworded
// message fails that test instead of being misread.
const GRANT_REFUSAL_PATTERNS: readonly RegExp[] = [
  /is not assignable to this page/,
  /does not belong to any of the granted groups/,
  /grantedGroups must not be empty/,
  /grant of the users top page must be public/,
];

const NOT_PROCESSABLE_PATTERN = /^Cannot process create$/;

export const classifyCreateError = (err: unknown): CreateErrorKind => {
  if (!(err instanceof Error)) {
    return 'unknown';
  }
  if (GRANT_REFUSAL_PATTERNS.some((pattern) => pattern.test(err.message))) {
    return 'grant-not-assignable';
  }
  if (NOT_PROCESSABLE_PATTERN.test(err.message)) {
    return 'not-processable';
  }
  return 'unknown';
};
