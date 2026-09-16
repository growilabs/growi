import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectionActionButton } from './SelectionActionButton';

// `t` returns the i18n key verbatim, so the label test asserts the component
// selected the correct i18n key — without coupling to translated text (which
// lives in the locale JSON, not here).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SelectionActionButton', () => {
  it('calls onCommit exactly once when clicked once', () => {
    const onCommit = vi.fn();
    render(<SelectionActionButton onCommit={onCommit} />);

    fireEvent.click(screen.getByTestId('selection-action-button'));

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('does not call onCommit merely from being rendered', () => {
    const onCommit = vi.fn();
    render(<SelectionActionButton onCommit={onCommit} />);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('calls onCommit once per click when clicked multiple times', () => {
    const onCommit = vi.fn();
    render(<SelectionActionButton onCommit={onCommit} />);

    const button = screen.getByTestId('selection-action-button');
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('renders as a Bootstrap 5 themed button, not a bare unstyled one', () => {
    const onCommit = vi.fn();
    render(<SelectionActionButton onCommit={onCommit} />);

    const button = screen.getByTestId('selection-action-button');
    expect(button).toHaveClass('btn');
    expect(button).toHaveClass('btn-sm');
  });

  it('shows the label via the inline_comment.start_comment i18n key, not an English-literal string', () => {
    const onCommit = vi.fn();
    render(<SelectionActionButton onCommit={onCommit} />);

    expect(
      screen.getByText('inline_comment.start_comment'),
    ).toBeInTheDocument();
  });

  it('renders the add_comment material icon alongside the label', () => {
    const onCommit = vi.fn();
    const { container } = render(<SelectionActionButton onCommit={onCommit} />);

    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).toHaveTextContent('add_comment');
  });
});
