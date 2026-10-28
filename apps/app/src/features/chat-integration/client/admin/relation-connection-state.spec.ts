// The badge on a relation's row must not say "active" for a relation the
// proxy no longer accepts (Requirements 9.9, 9.11), and must not claim a
// loss it cannot know about when the check failed for another reason.

import { describe, expect, it } from 'vitest';

import {
  deriveRelationBadge,
  isConnectionRejected,
} from './relation-connection-state';

// What `apiv3Get` rejects with: an array of ErrorV3 bodies.
const rejectedError = [{ code: 'rejected', message: 'rejected' }];
const unreachableError = [{ code: 'unreachable', message: 'unreachable' }];

describe('isConnectionRejected', () => {
  it('is true for the failure the server reports when the proxy refused the signature', () => {
    expect(isConnectionRejected(rejectedError)).toBe(true);
  });

  it.each([
    ['another failure code', unreachableError],
    ['an empty list of errors', []],
    ['a plain Error', new Error('network')],
    ['undefined (no error)', undefined],
    ['null', null],
    ['a malformed item', [null]],
  ])('is false for %s', (_label, error) => {
    expect(isConnectionRejected(error)).toBe(false);
  });
});

describe('deriveRelationBadge', () => {
  it('shows an unpaired relation as unpaired', () => {
    expect(deriveRelationBadge('unpaired', undefined)).toBe('unpaired');
  });

  it('shows an active relation with a healthy check as active', () => {
    expect(deriveRelationBadge('active', undefined)).toBe('active');
  });

  it('shows an active relation as connection-lost when the proxy rejected the signature', () => {
    expect(deriveRelationBadge('active', rejectedError)).toBe(
      'connection-lost',
    );
  });

  it('keeps an active relation active when the check failed for another reason', () => {
    expect(deriveRelationBadge('active', unreachableError)).toBe('active');
  });

  it('keeps an active relation active while the check is still loading', () => {
    expect(deriveRelationBadge('active', undefined)).toBe('active');
  });

  it('does not turn an unpaired relation into connection-lost, whatever error is held', () => {
    expect(deriveRelationBadge('unpaired', rejectedError)).toBe('unpaired');
  });
});
