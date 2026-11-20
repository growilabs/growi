import type { IUser } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import { buildActionUsersLabel } from './build-action-users-label';

const user = (name: string): IUser => mock<IUser>({ name });

describe('buildActionUsersLabel', () => {
  it('returns a single mention for one user', () => {
    expect(buildActionUsersLabel([user('alice')])).toBe('@alice');
  });

  it('joins two or three users with commas', () => {
    expect(buildActionUsersLabel([user('alice'), user('bob')])).toBe(
      '@alice, @bob',
    );
    expect(
      buildActionUsersLabel([user('alice'), user('bob'), user('carol')]),
    ).toBe('@alice, @bob, @carol');
  });

  it('summarises four or more users as "and N others"', () => {
    expect(
      buildActionUsersLabel([
        user('alice'),
        user('bob'),
        user('carol'),
        user('dave'),
        user('erin'),
      ]),
    ).toBe('@alice, @bob and 3 others');
  });

  // PR #11510: a null actionUser (from an activity with no resolvable user)
  // must neither crash nor be counted.
  it('drops null entries without crashing and excludes them from the label', () => {
    expect(buildActionUsersLabel([user('alice'), null, user('bob')])).toBe(
      '@alice, @bob',
    );
  });

  it('counts only non-null users in the "others" tail', () => {
    // 4 real users + 1 null -> "and 2 others" (based on the 4, not 5).
    expect(
      buildActionUsersLabel([
        user('alice'),
        user('bob'),
        user('carol'),
        user('dave'),
        null,
      ]),
    ).toBe('@alice, @bob and 2 others');
  });

  it('returns an empty string when every entry is null or the list is empty', () => {
    expect(buildActionUsersLabel([null, undefined])).toBe('');
    expect(buildActionUsersLabel([])).toBe('');
  });
});
