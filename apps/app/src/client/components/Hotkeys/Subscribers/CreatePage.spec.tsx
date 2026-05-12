import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockOpen = vi.hoisted(() => vi.fn());

vi.mock('~/states/page', () => ({
  useCurrentPagePath: vi.fn(() => '/test/page'),
}));
vi.mock('~/states/ui/modal/page-create', () => ({
  usePageCreateModalActions: vi.fn(() => ({ open: mockOpen })),
}));

const { CreatePage, hotkeyBindings } = await import('./CreatePage');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CreatePage', () => {
  describe('hotkeyBindings', () => {
    it('defines "c" key as single category', () => {
      expect(hotkeyBindings).toEqual({
        keys: 'c',
        category: 'single',
      });
    });
  });

  describe('behavior', () => {
    it('opens create modal with current page path and calls onDeleteRender', () => {
      const onDeleteRender = vi.fn();

      render(<CreatePage onDeleteRender={onDeleteRender} />);

      expect(mockOpen).toHaveBeenCalledWith('/test/page');
      expect(onDeleteRender).toHaveBeenCalledOnce();
    });
  });
});
