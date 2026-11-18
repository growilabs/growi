import type { ReviewerInput, ReviewerRef } from '../../interfaces';
import {
  activeReviewers,
  dedupeReviewerInputs,
  deriveViewerRole,
  hasForeignReviewer,
  isReviewer,
  type ViewerIdentity,
} from './reviewer-model';

const at = new Date('2026-01-01T00:00:00Z');

const ref = (
  kind: ReviewerRef['kind'],
  id: string,
  removed = false,
): ReviewerRef => ({
  kind,
  id,
  addedBy: 'requester',
  addedAt: at,
  ...(removed ? { removedBy: 'requester', removedAt: at } : {}),
});

const viewer = (
  userId: string,
  groups: string[] = [],
  externalGroups: string[] = [],
): ViewerIdentity => ({
  userId,
  userGroupIds: new Set(groups),
  externalUserGroupIds: new Set(externalGroups),
});

describe('activeReviewers', () => {
  it('drops removed reviewers and keeps the rest in order (Req 18.4)', () => {
    const list = [
      ref('user', 'a'),
      ref('user', 'b', true),
      ref('user-group', 'g'),
    ];
    expect(activeReviewers(list).map((r) => r.id)).toEqual(['a', 'g']);
  });
});

describe('isReviewer', () => {
  it('matches the requester when they are listed next to other reviewers (Req 15.3)', () => {
    const list = [ref('user', 'req'), ref('user', 'u1')];
    expect(isReviewer(list, 'req', viewer('req'))).toBe(true);
  });

  it('matches a user reviewer by id (Req 15.2)', () => {
    expect(isReviewer([ref('user', 'u1')], 'req', viewer('u1'))).toBe(true);
    expect(isReviewer([ref('user', 'u1')], 'req', viewer('u2'))).toBe(false);
  });

  it('matches a GROWI user group by membership (Req 15.2, 16.4)', () => {
    const list = [ref('user-group', 'g1')];
    expect(isReviewer(list, 'req', viewer('u', ['g1']))).toBe(true);
    expect(isReviewer(list, 'req', viewer('u', ['g2']))).toBe(false);
  });

  it('matches an external user group only against external memberships (Req 15.2)', () => {
    const list = [ref('external-user-group', 'e1')];
    expect(isReviewer(list, 'req', viewer('u', [], ['e1']))).toBe(true);
    expect(isReviewer(list, 'req', viewer('u', ['e1'], []))).toBe(false);
  });

  it('matches when any of a mix of users and groups applies (Req 15.2)', () => {
    const list = [
      ref('user', 'u1'),
      ref('user-group', 'g1'),
      ref('external-user-group', 'e1'),
    ];
    expect(isReviewer(list, 'req', viewer('u1'))).toBe(true);
    expect(isReviewer(list, 'req', viewer('x', ['g1']))).toBe(true);
    expect(isReviewer(list, 'req', viewer('x', [], ['e1']))).toBe(true);
    expect(isReviewer(list, 'req', viewer('x', ['g9'], ['e9']))).toBe(false);
  });

  it('stops matching a user who left the group (Req 19.9)', () => {
    const list = [ref('user-group', 'g1')];
    expect(isReviewer(list, 'req', viewer('u', ['g1']))).toBe(true);
    expect(isReviewer(list, 'req', viewer('u', []))).toBe(false);
  });

  it('treats only the requester as reviewer when there are no reviewers (Req 15.4)', () => {
    expect(isReviewer([], 'req', viewer('req'))).toBe(true);
    expect(isReviewer([], 'req', viewer('other'))).toBe(false);
  });

  it('falls back to the requester when every reviewer was removed (Req 18.4)', () => {
    const list = [ref('user', 'u1', true), ref('user-group', 'g1', true)];
    expect(isReviewer(list, 'req', viewer('req'))).toBe(true);
    expect(isReviewer(list, 'req', viewer('u1', ['g1']))).toBe(false);
  });

  it('does not count the requester when other reviewers are set (Req 16.3)', () => {
    expect(isReviewer([ref('user', 'u1')], 'req', viewer('req'))).toBe(false);
  });

  it('ignores a removed reviewer', () => {
    expect(
      isReviewer(
        [ref('user', 'u1', true), ref('user', 'u2')],
        'req',
        viewer('u1'),
      ),
    ).toBe(false);
  });
});

describe('hasForeignReviewer', () => {
  it('is false with no reviewers (Req 15.11)', () => {
    expect(hasForeignReviewer([], 'req')).toBe(false);
  });

  it('is false when the only reviewer is the requester (Req 15.11)', () => {
    expect(hasForeignReviewer([ref('user', 'req')], 'req')).toBe(false);
  });

  it('is true for another user (Req 15.11)', () => {
    expect(hasForeignReviewer([ref('user', 'u1')], 'req')).toBe(true);
  });

  it.each([
    ['user-group' as const],
    ['external-user-group' as const],
  ])('is true for a %s even if its id equals the requester id (Req 15.11)', (kind) => {
    expect(hasForeignReviewer([ref(kind, 'req')], 'req')).toBe(true);
  });

  it('ignores removed reviewers (Req 15.11)', () => {
    expect(hasForeignReviewer([ref('user', 'u1', true)], 'req')).toBe(false);
  });
});

describe('dedupeReviewerInputs', () => {
  it('merges entries with the same kind and id, keeping the first (Req 15.6)', () => {
    const inputs: ReviewerInput[] = [
      { kind: 'user', id: 'a' },
      { kind: 'user-group', id: 'a' },
      { kind: 'user', id: 'a' },
      { kind: 'external-user-group', id: 'a' },
      { kind: 'user-group', id: 'a' },
    ];
    expect(dedupeReviewerInputs(inputs)).toEqual([
      { kind: 'user', id: 'a' },
      { kind: 'user-group', id: 'a' },
      { kind: 'external-user-group', id: 'a' },
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(dedupeReviewerInputs([])).toEqual([]);
  });
});

describe('deriveViewerRole', () => {
  it('is requester for the requester, even when also listed', () => {
    expect(deriveViewerRole('req', [ref('user', 'req')], viewer('req'))).toBe(
      'requester',
    );
    expect(deriveViewerRole('req', [], viewer('req'))).toBe('requester');
  });

  it('is reviewer for a matching viewer, via user or group', () => {
    const list = [ref('user', 'u1'), ref('user-group', 'g1')];
    expect(deriveViewerRole('req', list, viewer('u1'))).toBe('reviewer');
    expect(deriveViewerRole('req', list, viewer('x', ['g1']))).toBe('reviewer');
  });

  it('is other for everyone else, including after leaving the group (Req 19.9)', () => {
    const list = [ref('user-group', 'g1')];
    expect(deriveViewerRole('req', list, viewer('x', []))).toBe('other');
    expect(deriveViewerRole('req', [], viewer('x'))).toBe('other');
  });
});
