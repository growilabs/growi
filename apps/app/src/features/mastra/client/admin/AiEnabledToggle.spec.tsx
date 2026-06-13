// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
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
import type { AiSettingsFormValues } from './ai-settings-form-values';

// Minimal RHF context wrapper: the section reads `aiEnabled` from form context.
const FormHarness = ({
  defaultValues,
  children,
}: {
  defaultValues?: Partial<AiSettingsFormValues>;
  children: ReactNode;
}): JSX.Element => {
  const methods = useForm<AiSettingsFormValues>({
    defaultValues: { aiEnabled: false, ...defaultValues },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderToggle = ({
  disabled = false,
  defaultValues,
}: {
  disabled?: boolean;
  defaultValues?: Partial<AiSettingsFormValues>;
} = {}) =>
  render(
    <FormHarness defaultValues={defaultValues}>
      <AiEnabledToggle disabled={disabled} />
    </FormHarness>,
  );

describe('AiEnabledToggle', () => {
  it('reflects the enabled state via the switch checked attribute', () => {
    // Act
    renderToggle({ defaultValues: { aiEnabled: true } });

    // Assert
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
  });

  it('toggles the checked state when clicked', () => {
    // Arrange
    renderToggle({ defaultValues: { aiEnabled: false } });
    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();

    // Act
    fireEvent.click(toggle);

    // Assert
    expect(toggle).toBeChecked();
  });

  it('disables the switch when env-only mode is on', () => {
    // Act
    renderToggle({ disabled: true });

    // Assert
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
