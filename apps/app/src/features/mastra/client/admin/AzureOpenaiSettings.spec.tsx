// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  allowedModels: [{ model: '', providerOptionsText: '', isDefault: true }],
  azureOpenaiSettings: {
    resourceName: '',
    baseURL: '',
    apiVersion: '',
    useEntraId: false,
  },
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

  it('does not render the model/deployment-name field (it moved to the shared list editor)', () => {
    // Act
    renderComponent();

    // Assert: this section is now connection-only. The deployment-name field is
    // hosted by the shared `AllowedModelsField` (in ProviderCommonSettings), not
    // here, so neither model label appears within the Azure section.
    expect(
      screen.queryByLabelText('ai_settings.azure_model_deployment_label'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('ai_settings.model_label'),
    ).not.toBeInTheDocument();
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

  it('shows the Entra ID api-key note only when useEntraId is true', async () => {
    // Arrange: note hidden by default
    const user = userEvent.setup();
    renderComponent({
      defaultValues: {
        azureOpenaiSettings: {
          resourceName: '',
          baseURL: '',
          apiVersion: '',
          useEntraId: false,
        },
      },
    });
    expect(
      screen.queryByText('ai_settings.azure_entra_id_api_key_note'),
    ).not.toBeInTheDocument();

    // Act: toggle the Entra ID switch on
    await user.click(screen.getByRole('switch'));

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
