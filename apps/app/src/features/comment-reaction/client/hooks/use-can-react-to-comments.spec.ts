// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanReactToComments } from './use-can-react-to-comments';

const mocks = vi.hoisted(() => ({
  useIsGuestUser: vi.fn(),
  useIsSharedUser: vi.fn(),
  useIsCommentActionBlockedForReadOnlyUser: vi.fn(),
  useIsTrashPage: vi.fn(),
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: mocks.useIsGuestUser,
  useIsSharedUser: mocks.useIsSharedUser,
}));

vi.mock('~/client/components/NotAvailableForReadOnlyUser', () => ({
  useIsCommentActionBlockedForReadOnlyUser:
    mocks.useIsCommentActionBlockedForReadOnlyUser,
}));

vi.mock('~/states/page', () => ({
  useIsTrashPage: mocks.useIsTrashPage,
}));

type Conditions = {
  isReadOnly: boolean;
  isGuest: boolean;
  isShared: boolean;
  isBlockedReadOnlyUser: boolean;
  isTrash: boolean;
};

const allowed: Conditions = {
  isReadOnly: false,
  isGuest: false,
  isShared: false,
  isBlockedReadOnlyUser: false,
  isTrash: false,
};

const render = (conditions: Conditions): boolean => {
  mocks.useIsGuestUser.mockReturnValue(conditions.isGuest);
  mocks.useIsSharedUser.mockReturnValue(conditions.isShared);
  mocks.useIsCommentActionBlockedForReadOnlyUser.mockReturnValue(
    conditions.isBlockedReadOnlyUser,
  );
  mocks.useIsTrashPage.mockReturnValue(conditions.isTrash);
  return renderHook(() => useCanReactToComments(conditions.isReadOnly)).result
    .current;
};

describe('useCanReactToComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows reacting for a regular user on a regular page', () => {
    expect(render(allowed)).toBe(true);
  });

  it('allows reacting on a page in the trash', () => {
    expect(render({ ...allowed, isTrash: true })).toBe(true);
  });

  it('allows a read-only user when the setting allows read-only users to comment', () => {
    // useIsCommentActionBlockedForReadOnlyUser is false in this case; its own
    // spec covers how the setting maps to that flag.
    expect(render({ ...allowed, isBlockedReadOnlyUser: false })).toBe(true);
  });

  it('disallows a read-only user when the setting does not allow read-only users to comment', () => {
    expect(render({ ...allowed, isBlockedReadOnlyUser: true })).toBe(false);
  });

  it.each<[string, Partial<Conditions>]>([
    ['the hosting view is read-only', { isReadOnly: true }],
    ['the viewer is a guest', { isGuest: true }],
    ['the viewer opens a share link', { isShared: true }],
    [
      'a read-only user is not allowed to comment',
      { isBlockedReadOnlyUser: true },
    ],
  ])('disallows reacting when %s', (_label, override) => {
    expect(render({ ...allowed, ...override })).toBe(false);
  });

  it('disallows reacting when several conditions apply at once', () => {
    expect(render({ ...allowed, isGuest: true, isShared: true })).toBe(false);
  });
});
