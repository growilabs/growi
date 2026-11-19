import { toReactionUserDisplayName } from './to-reaction-user-display-name';

describe('toReactionUserDisplayName', () => {
  it('prefers the name', () => {
    expect(
      toReactionUserDisplayName({
        _id: 'u1',
        username: 'alice',
        name: 'Alice A.',
        imageUrlCached: '',
      }),
    ).toBe('Alice A.');
  });

  it('falls back to the username when the name is empty', () => {
    expect(
      toReactionUserDisplayName({
        _id: 'u2',
        username: 'bob',
        name: '',
        imageUrlCached: '',
      }),
    ).toBe('bob');
  });

  it('shows the ID string of a user that is no longer resolvable as is', () => {
    expect(toReactionUserDisplayName('64b0000000000000000000ff')).toBe(
      '64b0000000000000000000ff',
    );
  });
});
