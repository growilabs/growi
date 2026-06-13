// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Render i18n keys verbatim; assertions target the observable DOM contract
// (roles, disabled state, checked state) rather than translated copy, since the
// translation entries are added by a later task (5.3).
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import { AiEnabledToggle } from './AiEnabledToggle';

describe('AiEnabledToggle', () => {
  it('reflects the enabled state via the switch checked attribute', () => {
    // Act
    render(<AiEnabledToggle aiEnabled onChange={vi.fn()} disabled={false} />);

    // Assert
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
  });

  it('calls onChange with the toggled value when clicked', () => {
    // Arrange
    const onChange = vi.fn();
    render(
      <AiEnabledToggle
        aiEnabled={false}
        onChange={onChange}
        disabled={false}
      />,
    );

    // Act
    fireEvent.click(screen.getByRole('switch'));

    // Assert
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disables the switch when env-only mode is on', () => {
    // Act
    render(<AiEnabledToggle aiEnabled onChange={vi.fn()} disabled />);

    // Assert
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
