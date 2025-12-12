import type { ItemInstance } from '@headless-tree/core';
import { fireEvent, render, screen } from '@testing-library/react';

import type { IPageForItem } from '~/interfaces/page';

import { resetCreatingFlagForTesting } from '../states/_inner/page-tree-create';
import { CreateButtonInner } from './use-page-create';

// Mock the dependencies
vi.mock('~/client/components/NotAvailableForGuest', () => ({
  NotAvailableForGuest: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('~/client/components/NotAvailableForReadOnlyUser', () => ({
  NotAvailableForReadOnlyUser: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
}));

// Mock useCreatingParentId to control isCreating state
const mockUseCreatingParentId = vi.fn<() => string | null>(() => null);
vi.mock('../states/_inner', () => ({
  useCreatingParentId: () => mockUseCreatingParentId(),
  usePageTreeCreateActions: vi.fn(() => ({
    startCreating: vi.fn(),
    cancelCreating: vi.fn(),
  })),
}));

/**
 * Create a mock item instance for testing
 */
const createMockItem = (
  id: string,
  path: string = '/test/path',
): ItemInstance<IPageForItem> => {
  return {
    getId: () => id,
    getItemData: () => ({ _id: id, path }) as IPageForItem,
  } as unknown as ItemInstance<IPageForItem>;
};

describe('CreateButtonInner', () => {
  beforeEach(() => {
    resetCreatingFlagForTesting();
    mockUseCreatingParentId.mockReturnValue(null);
  });

  describe('rendering', () => {
    test('should render button for regular page', () => {
      const mockItem = createMockItem('page-id', '/regular/path');
      const onStartCreating = vi.fn();

      render(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    test('should NOT render button for users top page', () => {
      const mockItem = createMockItem('users-top', '/user');
      const onStartCreating = vi.fn();

      render(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('onMouseDown behavior', () => {
    test('should call preventDefault on mousedown to prevent focus change', () => {
      const mockItem = createMockItem('page-id');
      const onStartCreating = vi.fn();

      render(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      const button = screen.getByRole('button');

      // Use fireEvent which triggers React's synthetic event handler
      // and check if the event was prevented by examining defaultPrevented
      const mouseDownEvent = fireEvent.mouseDown(button);

      // fireEvent returns false if preventDefault was called
      // (the event's default action was prevented)
      expect(mouseDownEvent).toBe(false);
    });

    test('should preserve focus on input when clicking CreateButton', () => {
      const mockItem = createMockItem('page-id');
      const onStartCreating = vi.fn();

      render(
        <div>
          <input data-testid="placeholder-input" />
          <CreateButtonInner
            item={mockItem}
            onStartCreating={onStartCreating}
          />
        </div>,
      );

      const input = screen.getByTestId('placeholder-input');
      const button = screen.getByRole('button');

      // Focus the input
      input.focus();
      expect(document.activeElement).toBe(input);

      // mousedown on button - React's onMouseDown with preventDefault should fire
      const mouseDownEvent = fireEvent.mouseDown(button);

      // Verify preventDefault was called
      expect(mouseDownEvent).toBe(false);

      // Note: jsdom doesn't fully simulate focus behavior with preventDefault,
      // but we've verified preventDefault is called
    });
  });

  describe('onClick behavior', () => {
    test('should call onStartCreating with item when not already creating', () => {
      const mockItem = createMockItem('page-id');
      const onStartCreating = vi.fn();

      // isCreating = false (creatingParentId is null)
      mockUseCreatingParentId.mockReturnValue(null);

      render(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onStartCreating).toHaveBeenCalledTimes(1);
      expect(onStartCreating).toHaveBeenCalledWith(mockItem);
    });

    test('should NOT call onStartCreating when already creating', () => {
      const mockItem = createMockItem('page-id');
      const onStartCreating = vi.fn();

      // isCreating = true (creatingParentId is not null)
      mockUseCreatingParentId.mockReturnValue('some-parent-id');

      render(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onStartCreating).not.toHaveBeenCalled();
    });

    test('should call stopPropagation on click to prevent parent handlers', () => {
      const mockItem = createMockItem('page-id');
      const onStartCreating = vi.fn();
      const parentClickHandler = vi.fn();

      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: ignore
        // biome-ignore lint/a11y/useKeyWithClickEvents: ignore
        <div onClick={parentClickHandler}>
          <CreateButtonInner
            item={mockItem}
            onStartCreating={onStartCreating}
          />
        </div>,
      );

      const button = screen.getByRole('button');
      fireEvent.click(button);

      // Parent should not receive the click event
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });

  describe('rapid click prevention', () => {
    test('should ignore clicks when already in creating mode', () => {
      const mockItem = createMockItem('page-id');
      const onStartCreating = vi.fn();

      // Start with not creating
      mockUseCreatingParentId.mockReturnValue(null);

      const { rerender } = render(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      const button = screen.getByRole('button');

      // First click should work
      fireEvent.click(button);
      expect(onStartCreating).toHaveBeenCalledTimes(1);

      // Simulate that creating mode is now active
      mockUseCreatingParentId.mockReturnValue('page-id');

      rerender(
        <CreateButtonInner item={mockItem} onStartCreating={onStartCreating} />,
      );

      // Second click should be ignored
      fireEvent.click(button);
      expect(onStartCreating).toHaveBeenCalledTimes(1);
    });
  });
});
