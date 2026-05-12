import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../StaffCredit/StaffCredit', () => ({
  default: vi.fn(() => <div data-testid="staff-credit">StaffCredit</div>),
}));

const { default: StaffCredit } = await import('../../StaffCredit/StaffCredit');
const { ShowStaffCredit, hotkeyBindings } = await import('./ShowStaffCredit');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShowStaffCredit', () => {
  describe('hotkeyBindings', () => {
    it('defines the Konami code sequence as modifier category', () => {
      expect(hotkeyBindings).toEqual({
        keys: 'ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a',
        category: 'modifier',
      });
    });
  });

  describe('behavior', () => {
    it('renders StaffCredit with onDeleteRender passed as onClosed', () => {
      const onDeleteRender = vi.fn();

      render(<ShowStaffCredit onDeleteRender={onDeleteRender} />);

      expect(StaffCredit).toHaveBeenCalledWith(
        expect.objectContaining({ onClosed: onDeleteRender }),
        expect.anything(),
      );
      expect(screen.getByTestId('staff-credit')).toBeDefined();
    });
  });
});
