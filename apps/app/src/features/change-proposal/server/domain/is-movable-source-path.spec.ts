import { isMovableSourcePath } from './is-movable-source-path';

describe('isMovableSourcePath', () => {
  it.each([
    '/',
    '/user',
    '/user/alice',
    '/trash',
    '/trash/notes',
    '/trash/user/alice/memo',
  ])('refuses %s', (path) => {
    expect(isMovableSourcePath(path)).toBe(false);
  });

  it.each([
    '/notes',
    '/user/alice/memo',
    '/日本語/全角　空白',
    '/trashcan',
    '/trash-talk',
    '/trashbin',
    '/user-guide',
    '/usernames',
  ])('allows %s', (path) => {
    expect(isMovableSourcePath(path)).toBe(true);
  });
});
