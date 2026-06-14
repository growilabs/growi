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

import { AzureOpenaiSettings } from './AzureOpenaiSettings';
import type { AiSettingsFormValues } from './ai-settings-form-values';

const defaultFormValues: AiSettingsFormValues = {
  aiEnabled: true,
  provider: 'azure-openai',
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
  disabled = false,
  defaultValues,
}: {
  disabled?: boolean;
  defaultValues?: Partial<AiSettingsFormValues>;
} = {}) =>
  render(
    <FormHarness defaultValues={defaultValues}>
      <AzureOpenaiSettings disabled={disabled} />
    </FormHarness>,
  );

describe('AzureOpenaiSettings', () => {
  it('renders nothing when the provider is not azure-openai', () => {
    // Act
    const { container } = renderComponent({
      defaultValues: { provider: 'openai' },
    });

    // Assert
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the model field labelled as the Azure deployment name', () => {
    // Act
    renderComponent();

    // Assert: the shared `ai:model` field lives in the Azure section for this
    // provider, labelled as the deployment name.
    expect(
      screen.getByLabelText('ai_settings.azure_model_deployment_label'),
    ).toBeInTheDocument();
  });

  it('renders the four azure fields when the provider is azure-openai', () => {
    // Act
    renderComponent();

    // Assert
    expect(
      screen.getByLabelText('ai_settings.azure_resource_name_label'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('ai_settings.azure_base_url_label'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('ai_settings.azure_api_version_label'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows the Entra ID api-key note only when useEntraId is true', () => {
    // Arrange: note hidden by default
    renderComponent({ defaultValues: { azureOpenaiUseEntraId: false } });
    expect(
      screen.queryByText('ai_settings.azure_entra_id_api_key_note'),
    ).not.toBeInTheDocument();

    // Act: toggle the Entra ID switch on
    fireEvent.click(screen.getByRole('switch'));

    // Assert
    expect(
      screen.getByText('ai_settings.azure_entra_id_api_key_note'),
    ).toBeInTheDocument();
  });

  it('disables every input (not focusable) in env-only mode', () => {
    // Act
    renderComponent({ disabled: true });

    // Assert: disabled (not readOnly) so the locked fields cannot be focused.
    expect(
      screen.getByLabelText('ai_settings.azure_resource_name_label'),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('ai_settings.azure_base_url_label'),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('ai_settings.azure_api_version_label'),
    ).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
