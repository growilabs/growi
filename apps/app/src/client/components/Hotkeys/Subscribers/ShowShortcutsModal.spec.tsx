import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockOpen = vi.hoisted(() => vi.fn());
const mockUseShortcutsModalStatus = vi.hoisted(() => vi.fn());

vi.mock('~/states/ui/modal/shortcuts', () => ({
  useShortcutsModalStatus: mockUseShortcutsModalStatus,
  useShortcutsModalActions: vi.fn(() => ({ open: mockOpen })),
}));

const { ShowShortcutsModal, hotkeyBindings } = await import(
  './ShowShortcutsModal'
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShowShortcutsModal', () => {
  describe('hotkeyBindings', () => {
    it('defines Ctrl+/ and Meta+/ as modifier category', () => {
      expect(hotkeyBindings).toEqual({
        keys: ['Control+/', 'Meta+/'],
        category: 'modifier',
      });
    });
  });

  describe('behavior', () => {
    it('opens shortcuts modal when not already opened and calls onDeleteRender', () => {
      mockUseShortcutsModalStatus.mockReturnValue({ isOpened: false });
      const onDeleteRender = vi.fn();

      render(<ShowShortcutsModal onDeleteRender={onDeleteRender} />);

      expect(mockOpen).toHaveBeenCalledOnce();
      expect(onDeleteRender).toHaveBeenCalledOnce();
    });

    it('does not open modal when already opened', () => {
      mockUseShortcutsModalStatus.mockReturnValue({ isOpened: true });
      const onDeleteRender = vi.fn();

      render(<ShowShortcutsModal onDeleteRender={onDeleteRender} />);

      expect(mockOpen).not.toHaveBeenCalled();
      expect(onDeleteRender).not.toHaveBeenCalled();
    });

    it('does not open modal when status is null', () => {
      mockUseShortcutsModalStatus.mockReturnValue(null);
      const onDeleteRender = vi.fn();

      render(<ShowShortcutsModal onDeleteRender={onDeleteRender} />);

      expect(mockOpen).not.toHaveBeenCalled();
    });
  });
});
