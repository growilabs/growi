import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockOpen = vi.hoisted(() => vi.fn());
const mockUseIsEditable = vi.hoisted(() => vi.fn());
const mockUseSearchModalStatus = vi.hoisted(() => vi.fn());

vi.mock('~/states/page', () => ({
  useIsEditable: mockUseIsEditable,
}));
vi.mock('~/features/search/client/states/modal/search', () => ({
  useSearchModalStatus: mockUseSearchModalStatus,
  useSearchModalActions: vi.fn(() => ({ open: mockOpen })),
}));

const { FocusToGlobalSearch, hotkeyBindings } = await import(
  './FocusToGlobalSearch'
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FocusToGlobalSearch', () => {
  describe('hotkeyBindings', () => {
    it('defines "/" key as single category', () => {
      expect(hotkeyBindings).toEqual({
        keys: '/',
        category: 'single',
      });
    });
  });

  describe('behavior', () => {
    it('opens search modal when editable and not already opened, then calls onDeleteRender', () => {
      mockUseIsEditable.mockReturnValue(true);
      mockUseSearchModalStatus.mockReturnValue({ isOpened: false });
      const onDeleteRender = vi.fn();

      render(<FocusToGlobalSearch onDeleteRender={onDeleteRender} />);

      expect(mockOpen).toHaveBeenCalledOnce();
      expect(onDeleteRender).toHaveBeenCalledOnce();
    });

    it('does not open search modal when not editable', () => {
      mockUseIsEditable.mockReturnValue(false);
      mockUseSearchModalStatus.mockReturnValue({ isOpened: false });
      const onDeleteRender = vi.fn();

      render(<FocusToGlobalSearch onDeleteRender={onDeleteRender} />);

      expect(mockOpen).not.toHaveBeenCalled();
      expect(onDeleteRender).not.toHaveBeenCalled();
    });

    it('does not open search modal when already opened', () => {
      mockUseIsEditable.mockReturnValue(true);
      mockUseSearchModalStatus.mockReturnValue({ isOpened: true });
      const onDeleteRender = vi.fn();

      render(<FocusToGlobalSearch onDeleteRender={onDeleteRender} />);

      expect(mockOpen).not.toHaveBeenCalled();
      expect(onDeleteRender).not.toHaveBeenCalled();
    });
  });
});
