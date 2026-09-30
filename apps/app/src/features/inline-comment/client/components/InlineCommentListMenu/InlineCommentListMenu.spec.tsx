import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  InlineCommentListMenu,
  type InlineCommentListMenuItem,
} from './InlineCommentListMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const buildItem = (
  overrides: Partial<InlineCommentListMenuItem> = {},
): InlineCommentListMenuItem => ({
  id: 'expand-all',
  labelKey: 'inline_comment.expand_all_resolved',
  disabled: false,
  onSelect: vi.fn(),
  ...overrides,
});

const openMenu = (): void => {
  fireEvent.click(
    screen.getByRole('button', { name: 'inline_comment.list_menu' }),
  );
};

describe('InlineCommentListMenu', () => {
  it('opens the menu, and shows its items, when the three-dot button is pressed (Requirement 22.1, 22.2)', () => {
    render(<InlineCommentListMenu items={[buildItem()]} />);
    const toggle = screen.getByRole('button', {
      name: 'inline_comment.list_menu',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('menuitem', {
        name: 'inline_comment.expand_all_resolved',
      }),
    ).toBeVisible();
  });

  it('calls only the selected item onSelect, exactly once (Requirement 22.2)', () => {
    const first = buildItem({ id: 'first', labelKey: 'label.first' });
    const second = buildItem({ id: 'second', labelKey: 'label.second' });
    render(<InlineCommentListMenu items={[first, second]} />);

    openMenu();
    fireEvent.click(screen.getByText('label.second'));

    expect(second.onSelect).toHaveBeenCalledTimes(1);
    expect(first.onSelect).not.toHaveBeenCalled();
  });

  it('shows a disabled item as disabled and does not call its onSelect (Requirement 22.2)', () => {
    const item = buildItem({ disabled: true });
    render(<InlineCommentListMenu items={[item]} />);

    openMenu();
    const entry = screen.getByText('inline_comment.expand_all_resolved');
    fireEvent.click(entry);

    expect(entry.closest('button')).toBeDisabled();
    expect(item.onSelect).not.toHaveBeenCalled();
  });

  it('follows the items array alone when an item is added or removed (Requirement 22.6)', () => {
    const base = buildItem({ id: 'base', labelKey: 'label.base' });
    const extra = buildItem({ id: 'extra', labelKey: 'label.extra' });
    const { rerender } = render(<InlineCommentListMenu items={[base]} />);

    openMenu();
    expect(screen.getByText('label.base')).toBeInTheDocument();
    expect(screen.queryByText('label.extra')).not.toBeInTheDocument();

    rerender(<InlineCommentListMenu items={[base, extra]} />);
    expect(screen.getByText('label.base')).toBeInTheDocument();
    expect(screen.getByText('label.extra')).toBeInTheDocument();

    rerender(<InlineCommentListMenu items={[extra]} />);
    expect(screen.queryByText('label.base')).not.toBeInTheDocument();
    expect(screen.getByText('label.extra')).toBeInTheDocument();
  });

  it('renders the toggle as a theme-following link button, not the default btn-secondary (Requirement 22.1)', () => {
    render(<InlineCommentListMenu items={[buildItem()]} />);

    const toggle = screen.getByRole('button', {
      name: 'inline_comment.list_menu',
    });
    expect(toggle).toHaveClass('btn', 'btn-link');
    expect(toggle).not.toHaveClass('btn-secondary');
  });
  it('aligns the opened menu to the right edge of the button (Requirement 22.1)', () => {
    render(<InlineCommentListMenu items={[buildItem()]} />);

    openMenu();

    expect(screen.getByRole('menu')).toHaveClass('dropdown-menu-end');
  });
});
