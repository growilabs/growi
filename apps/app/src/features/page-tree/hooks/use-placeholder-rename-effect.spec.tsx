import type { ItemInstance } from '@headless-tree/core';
import { renderHook } from '@testing-library/react';

import type { IPageForItem } from '~/interfaces/page';

import { CREATING_PAGE_VIRTUAL_ID } from '../constants/_inner';
import { usePlaceholderRenameEffect } from './use-placeholder-rename-effect';

/**
 * Create a mock item instance for testing
 */
const createMockItem = (
  id: string,
  options: {
    isRenaming?: boolean;
  } = {},
): ItemInstance<IPageForItem> & { setIsRenaming: (value: boolean) => void } => {
  let isRenaming = options.isRenaming ?? false;

  const item = {
    getId: () => id,
    getItemData: () => ({ _id: id }) as IPageForItem,
    isRenaming: vi.fn(() => isRenaming),
    startRenaming: vi.fn(() => {
      isRenaming = true;
    }),
    // Helper to simulate external renaming state changes (e.g., ESC key press)
    setIsRenaming: (value: boolean) => {
      isRenaming = value;
    },
  } as unknown as ItemInstance<IPageForItem> & {
    setIsRenaming: (value: boolean) => void;
  };

  return item;
};

describe('usePlaceholderRenameEffect', () => {
  describe('when item is a placeholder', () => {
    test('should call startRenaming when placeholder is not in renaming mode', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: false,
      });
      const onCancelCreate = vi.fn();

      renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      expect(mockItem.startRenaming).toHaveBeenCalledTimes(1);
      expect(onCancelCreate).not.toHaveBeenCalled();
    });

    test('should not call startRenaming when placeholder is already in renaming mode', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: true,
      });
      const onCancelCreate = vi.fn();

      renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      expect(mockItem.startRenaming).not.toHaveBeenCalled();
      expect(onCancelCreate).not.toHaveBeenCalled();
    });

    test('should call onCancelCreate when renaming mode ends (ESC key simulation)', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: false,
      });
      const onCancelCreate = vi.fn();

      const { rerender } = renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      // Initial render: startRenaming should be called
      expect(mockItem.startRenaming).toHaveBeenCalledTimes(1);

      // Simulate renaming becoming active (startRenaming succeeded)
      mockItem.setIsRenaming(true);
      rerender();

      // onCancelCreate should not be called yet
      expect(onCancelCreate).not.toHaveBeenCalled();

      // Simulate ESC key press - renaming mode ends
      mockItem.setIsRenaming(false);
      rerender();

      // onCancelCreate should be called
      expect(onCancelCreate).toHaveBeenCalledTimes(1);
    });

    test('should not call onCancelCreate if renaming was never active', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: false,
      });
      const onCancelCreate = vi.fn();

      // Mock startRenaming to NOT actually change isRenaming state
      // This simulates a scenario where startRenaming fails
      mockItem.startRenaming = vi.fn();

      const { rerender } = renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      // startRenaming was called but didn't change state
      expect(mockItem.startRenaming).toHaveBeenCalled();

      // Rerender with still false
      rerender();

      // onCancelCreate should NOT be called because wasRenamingRef was never true
      expect(onCancelCreate).not.toHaveBeenCalled();
    });

    test('should re-call startRenaming when isRenaming becomes false after rapid clicks', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: false,
      });
      const onCancelCreate = vi.fn();

      const { rerender } = renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      // First render: startRenaming called
      expect(mockItem.startRenaming).toHaveBeenCalledTimes(1);

      // Simulate renaming becoming active
      mockItem.setIsRenaming(true);
      rerender();

      // Simulate rapid click resetting the renaming state (this was the bug)
      mockItem.setIsRenaming(false);
      // Reset the mock to track new calls
      mockItem.startRenaming = vi.fn(() => {
        mockItem.setIsRenaming(true);
      });
      rerender();

      // startRenaming should be called again because isRenaming is now false
      // This is the key fix - the effect re-runs when isRenaming changes
      expect(mockItem.startRenaming).toHaveBeenCalledTimes(1);
    });
  });

  describe('when item is NOT a placeholder', () => {
    test('should not call startRenaming for regular items', () => {
      const mockItem = createMockItem('regular-page-id', { isRenaming: false });
      const onCancelCreate = vi.fn();

      renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      expect(mockItem.startRenaming).not.toHaveBeenCalled();
      expect(onCancelCreate).not.toHaveBeenCalled();
    });

    test('should not call onCancelCreate for regular items even when renaming state changes', () => {
      const mockItem = createMockItem('regular-page-id', { isRenaming: true });
      const onCancelCreate = vi.fn();

      const { rerender } = renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      // Simulate renaming mode ending
      mockItem.setIsRenaming(false);
      rerender();

      // onCancelCreate should NOT be called for regular items
      expect(onCancelCreate).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    test('should handle multiple rerender cycles correctly', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: false,
      });
      const onCancelCreate = vi.fn();

      const { rerender } = renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      // Cycle 1: Start renaming
      expect(mockItem.startRenaming).toHaveBeenCalledTimes(1);
      mockItem.setIsRenaming(true);
      rerender();

      // Cycle 1: Cancel (ESC)
      mockItem.setIsRenaming(false);
      rerender();
      expect(onCancelCreate).toHaveBeenCalledTimes(1);

      // After cancel, isRenaming is false, so startRenaming will be called again on next rerender
      // This simulates the placeholder being re-rendered after cancel
      // (In real app, the placeholder would be removed, but this tests the hook's behavior)
      rerender();

      // The hook will try to start renaming again because isRenaming is false
      // This is expected behavior - the hook always tries to ensure placeholder is in renaming mode
      expect(mockItem.startRenaming).toHaveBeenCalledTimes(2);
    });

    test('should not call onCancelCreate multiple times for the same cancel event', () => {
      const mockItem = createMockItem(CREATING_PAGE_VIRTUAL_ID, {
        isRenaming: false,
      });
      const onCancelCreate = vi.fn();

      const { rerender } = renderHook(() =>
        usePlaceholderRenameEffect({
          item: mockItem,
          onCancelCreate,
        }),
      );

      // Start renaming
      mockItem.setIsRenaming(true);
      rerender();

      // Cancel
      mockItem.setIsRenaming(false);
      rerender();
      expect(onCancelCreate).toHaveBeenCalledTimes(1);

      // Multiple rerenders with same state should not trigger additional calls
      rerender();
      rerender();
      rerender();
      expect(onCancelCreate).toHaveBeenCalledTimes(1);
    });
  });
});
