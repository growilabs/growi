// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import type { AiSettingsFormValues } from './ai-settings-form-values';
import { ModelField } from './ModelField';

const defaultFormValues: AiSettingsFormValues = {
  aiEnabled: true,
  provider: 'openai',
  apiKey: '',
  model: '',
  providerOptions: '',
  azureOpenaiResourceName: '',
  azureOpenaiBaseUrl: '',
  azureOpenaiApiVersion: '',
  azureOpenaiUseEntraId: false,
};

const FormHarness = ({
  defaultValues,
  children,
}: {
  defaultValues?: Partial<AiSettingsFormValues>;
  children: ReactNode;
}): JSX.Element => {
  const methods = useForm<AiSettingsFormValues>({
    defaultValues: { ...defaultFormValues, ...defaultValues },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  labelKey = 'ai_settings.model_label',
  disabled = false,
  defaultValues,
}: {
  labelKey?: string;
  disabled?: boolean;
  defaultValues?: Partial<AiSettingsFormValues>;
} = {}) =>
  render(
    <FormHarness defaultValues={defaultValues}>
      <ModelField labelKey={labelKey} disabled={disabled} />
    </FormHarness>,
  );

describe('ModelField', () => {
  it('renders a text input labelled by the supplied labelKey', () => {
    // Act: the same field is reused with a provider-specific label.
    renderComponent({ labelKey: 'ai_settings.azure_model_deployment_label' });

    // Assert
    const input = screen.getByLabelText(
      'ai_settings.azure_model_deployment_label',
    );
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('binds the input to the form `model` value', () => {
    // Arrange
    renderComponent({ defaultValues: { model: 'gpt-4o' } });

    // Assert: seeded value is shown...
    const input = screen.getByLabelText(
      'ai_settings.model_label',
    ) as HTMLInputElement;
    expect(input.value).toBe('gpt-4o');

    // ...and edits flow back into the field.
    fireEvent.change(input, { target: { value: 'my-deployment' } });
    expect(input.value).toBe('my-deployment');
  });

  it('disables the input (not focusable) in env-only mode', () => {
    // Act
    renderComponent({ disabled: true });

    // Assert: disabled (not readOnly) so the locked field is out of the tab order.
    expect(screen.getByLabelText('ai_settings.model_label')).toBeDisabled();
  });
});
