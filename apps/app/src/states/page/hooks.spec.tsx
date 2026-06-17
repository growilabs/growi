import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';

import { _atomsForDerivedAbilities } from '../global';

import { currentPageDataAtom } from './internal-atoms';

import {
  useCurrentPageReadOnlyUserIds,
  useIsReadOnlyUserForPage,
} from './hooks';

describe('useCurrentPageReadOnlyUserIds', () => {
  let store: ReturnType<typeof createStore>;

  const renderHookWithProvider = () => {
    return renderHook(() => useCurrentPageReadOnlyUserIds(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
  };

  beforeEach(() => {
    store = createStore();
  });

  it('should return empty array when no page data', () => {
    const { result } = renderHookWithProvider();
    expect(result.current).toEqual([]);
  });

  it('should return readOnlyUserIds from page data', () => {
    store.set(currentPageDataAtom, {
      readOnlyUserIds: ['user1', 'user2'],
    } as any);
    const { result } = renderHookWithProvider();
    expect(result.current).toEqual(['user1', 'user2']);
  });

  it('should return empty array when readOnlyUserIds is undefined', () => {
    store.set(currentPageDataAtom, {} as any);
    const { result } = renderHookWithProvider();
    expect(result.current).toEqual([]);
  });
});

describe('useIsReadOnlyUserForPage', () => {
  let store: ReturnType<typeof createStore>;

  const renderHookWithProvider = () => {
    return renderHook(() => useIsReadOnlyUserForPage(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
  };

  beforeEach(() => {
    store = createStore();
    store.set(_atomsForDerivedAbilities.currentUserAtom, {
      _id: 'currentUserId',
      name: 'Test User',
      username: 'testuser',
      email: 'test@example.com',
    } as any);
  });

  it('should return false when no page data', () => {
    const { result } = renderHookWithProvider();
    expect(result.current).toBe(false);
  });

  it('should return true when current user is in readOnlyUserIds', () => {
    store.set(currentPageDataAtom, {
      readOnlyUserIds: ['currentUserId', 'otherUser'],
    } as any);
    const { result } = renderHookWithProvider();
    expect(result.current).toBe(true);
  });

  it('should return false when current user is not in readOnlyUserIds', () => {
    store.set(currentPageDataAtom, {
      readOnlyUserIds: ['otherUser1', 'otherUser2'],
    } as any);
    const { result } = renderHookWithProvider();
    expect(result.current).toBe(false);
  });

  it('should return false when readOnlyUserIds is empty', () => {
    store.set(currentPageDataAtom, {
      readOnlyUserIds: [],
    } as any);
    const { result } = renderHookWithProvider();
    expect(result.current).toBe(false);
  });
});
