import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockStartEditing = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockUseIsEditable = vi.hoisted(() => vi.fn());
const mockUseCurrentPagePath = vi.hoisted(() => vi.fn());
const mockUseCurrentPathname = vi.hoisted(() => vi.fn());

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      `${key}:${JSON.stringify(opts)}`,
  }),
}));
vi.mock('~/client/services/use-start-editing', () => ({
  useStartEditing: () => mockStartEditing,
}));
vi.mock('~/client/util/toastr', () => ({
  toastError: mockToastError,
}));
vi.mock('~/states/global', () => ({
  useCurrentPathname: mockUseCurrentPathname,
}));
vi.mock('~/states/page', () => ({
  useCurrentPagePath: mockUseCurrentPagePath,
  useIsEditable: mockUseIsEditable,
}));

const { EditPage, hotkeyBindings } = await import('./EditPage');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EditPage', () => {
  describe('hotkeyBindings', () => {
    it('defines "e" key as single category', () => {
      expect(hotkeyBindings).toEqual({
        keys: 'e',
        category: 'single',
      });
    });
  });

  describe('behavior', () => {
    it('calls startEditing with current page path and then onDeleteRender', async () => {
      mockUseIsEditable.mockReturnValue(true);
      mockUseCurrentPagePath.mockReturnValue('/test/page');
      mockUseCurrentPathname.mockReturnValue('/fallback');
      mockStartEditing.mockResolvedValue(undefined);
      const onDeleteRender = vi.fn();

      render(<EditPage onDeleteRender={onDeleteRender} />);

      await waitFor(() => {
        expect(mockStartEditing).toHaveBeenCalledWith('/test/page');
        expect(onDeleteRender).toHaveBeenCalledOnce();
      });
    });

    it('falls back to currentPathname when currentPagePath is null', async () => {
      mockUseIsEditable.mockReturnValue(true);
      mockUseCurrentPagePath.mockReturnValue(null);
      mockUseCurrentPathname.mockReturnValue('/fallback/path');
      mockStartEditing.mockResolvedValue(undefined);
      const onDeleteRender = vi.fn();

      render(<EditPage onDeleteRender={onDeleteRender} />);

      await waitFor(() => {
        expect(mockStartEditing).toHaveBeenCalledWith('/fallback/path');
      });
    });

    it('does not call startEditing when page is not editable', async () => {
      mockUseIsEditable.mockReturnValue(false);
      mockUseCurrentPagePath.mockReturnValue('/test/page');
      mockUseCurrentPathname.mockReturnValue('/fallback');
      const onDeleteRender = vi.fn();

      render(<EditPage onDeleteRender={onDeleteRender} />);

      // Give async useEffect time to execute
      await waitFor(() => {
        expect(mockStartEditing).not.toHaveBeenCalled();
      });
    });

    it('does not call startEditing when a modal is open', async () => {
      mockUseIsEditable.mockReturnValue(true);
      mockUseCurrentPagePath.mockReturnValue('/test/page');
      mockUseCurrentPathname.mockReturnValue('/fallback');

      // Simulate an open Bootstrap modal in the DOM
      // happy-dom does not fully support multi-class getElementsByClassName,
      // so we spy on the boundary (DOM API) directly
      const mockCollection = [document.createElement('div')];
      vi.spyOn(document, 'getElementsByClassName').mockReturnValue(
        mockCollection as unknown as HTMLCollectionOf<Element>,
      );

      const onDeleteRender = vi.fn();

      render(<EditPage onDeleteRender={onDeleteRender} />);

      await waitFor(() => {
        expect(mockStartEditing).not.toHaveBeenCalled();
      });
    });

    it('shows toast error when startEditing fails', async () => {
      mockUseIsEditable.mockReturnValue(true);
      mockUseCurrentPagePath.mockReturnValue('/failing/page');
      mockUseCurrentPathname.mockReturnValue('/fallback');
      mockStartEditing.mockRejectedValue(new Error('edit failed'));
      const onDeleteRender = vi.fn();

      render(<EditPage onDeleteRender={onDeleteRender} />);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          expect.stringContaining('toaster.create_failed'),
        );
        expect(onDeleteRender).toHaveBeenCalledOnce();
      });
    });
  });
});
