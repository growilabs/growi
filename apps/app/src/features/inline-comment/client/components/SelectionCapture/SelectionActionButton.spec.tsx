import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectionActionButton } from './SelectionActionButton';

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
});
