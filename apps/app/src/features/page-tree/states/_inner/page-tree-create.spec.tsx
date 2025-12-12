import { act, renderHook } from '@testing-library/react';

import {
  resetCreatingFlagForTesting,
  useCreatingParentId,
  usePageTreeCreateActions,
} from './page-tree-create';

describe('page-tree-create', () => {
  beforeEach(() => {
    // Reset the module-level flag before each test
    resetCreatingFlagForTesting();
  });

  describe('usePageTreeCreateActions', () => {
    describe('startCreating', () => {
      test('should set creatingParentInfo on first call', () => {
        const { result: actionsResult } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: parentIdResult } = renderHook(() =>
          useCreatingParentId(),
        );

        act(() => {
          actionsResult.current.startCreating('parent-id-1', '/parent/path');
        });

        expect(parentIdResult.current).toBe('parent-id-1');
      });

      test('should ignore rapid clicks (multiple startCreating calls)', () => {
        const { result: actionsResult } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: parentIdResult } = renderHook(() =>
          useCreatingParentId(),
        );

        // First call should succeed
        act(() => {
          actionsResult.current.startCreating('parent-id-1', '/parent/path1');
        });

        expect(parentIdResult.current).toBe('parent-id-1');

        // Second call should be ignored (rapid click)
        act(() => {
          actionsResult.current.startCreating('parent-id-2', '/parent/path2');
        });

        // Should still be the first parent
        expect(parentIdResult.current).toBe('parent-id-1');
      });

      test('should ignore rapid clicks even from different hook instances', () => {
        // Simulate different components calling the hook
        const { result: actionsResult1 } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: actionsResult2 } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: parentIdResult } = renderHook(() =>
          useCreatingParentId(),
        );

        // First call from instance 1
        act(() => {
          actionsResult1.current.startCreating('parent-id-1', '/parent/path1');
        });

        expect(parentIdResult.current).toBe('parent-id-1');

        // Second call from instance 2 should be ignored
        act(() => {
          actionsResult2.current.startCreating('parent-id-2', '/parent/path2');
        });

        // Should still be the first parent
        expect(parentIdResult.current).toBe('parent-id-1');
      });
    });

    describe('cancelCreating', () => {
      test('should reset creatingParentInfo to null', () => {
        const { result: actionsResult } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: parentIdResult } = renderHook(() =>
          useCreatingParentId(),
        );

        // Start creating
        act(() => {
          actionsResult.current.startCreating('parent-id-1', '/parent/path');
        });

        expect(parentIdResult.current).toBe('parent-id-1');

        // Cancel
        act(() => {
          actionsResult.current.cancelCreating();
        });

        expect(parentIdResult.current).toBeNull();
      });

      test('should allow startCreating to work again after cancelCreating', () => {
        const { result: actionsResult } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: parentIdResult } = renderHook(() =>
          useCreatingParentId(),
        );

        // First cycle: start and cancel
        act(() => {
          actionsResult.current.startCreating('parent-id-1', '/parent/path1');
        });

        expect(parentIdResult.current).toBe('parent-id-1');

        act(() => {
          actionsResult.current.cancelCreating();
        });

        expect(parentIdResult.current).toBeNull();

        // Second cycle: should be able to start again
        act(() => {
          actionsResult.current.startCreating('parent-id-2', '/parent/path2');
        });

        expect(parentIdResult.current).toBe('parent-id-2');
      });

      test('should reset flag correctly so different hook instance can start', () => {
        const { result: actionsResult1 } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: actionsResult2 } = renderHook(() =>
          usePageTreeCreateActions(),
        );
        const { result: parentIdResult } = renderHook(() =>
          useCreatingParentId(),
        );

        // Instance 1 starts
        act(() => {
          actionsResult1.current.startCreating('parent-id-1', '/parent/path1');
        });

        // Instance 2 cancels (this can happen from a different component)
        act(() => {
          actionsResult2.current.cancelCreating();
        });

        expect(parentIdResult.current).toBeNull();

        // Instance 2 should now be able to start
        act(() => {
          actionsResult2.current.startCreating('parent-id-2', '/parent/path2');
        });

        expect(parentIdResult.current).toBe('parent-id-2');
      });
    });
  });
});
