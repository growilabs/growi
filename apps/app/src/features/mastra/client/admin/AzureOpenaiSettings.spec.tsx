// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

// Render i18n keys verbatim; assertions target the observable DOM contract
// (labels, disabled state, bound form values) rather than translated copy.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import { AzureOpenaiSettings } from './AzureOpenaiSettings';
import type {
  AiSettingsFormValues,
  ProviderFormValue,
} from './ai-settings-form-values';

const emptyProvider = (): ProviderFormValue => ({
  enabled: false,
  apiKey: '',
  azureOpenaiSettings: {
    resourceName: '',
    baseURL: '',
    apiVersion: '',
    useEntraId: false,
  },
});

const buildFormValues = (
  azureOverrides?: Partial<ProviderFormValue['azureOpenaiSettings']>,
): AiSettingsFormValues => ({
  aiEnabled: true,
  providers: {
    openai: emptyProvider(),
    anthropic: emptyProvider(),
    google: emptyProvider(),
    'azure-openai': {
      ...emptyProvider(),
      azureOpenaiSettings: {
        ...emptyProvider().azureOpenaiSettings,
        ...azureOverrides,
      },
    },
  },
  allowedModels: [],
});

/**
 * Read-only probe that mirrors the azure-openai slot's connection settings into
 * the DOM so a test can assert the form value at
 * `providers.azure-openai.azureOpenaiSettings.*` (the write direction of the
 * register binding), independent of the input's own DOM value.
 */
const AzureSettingsProbe = (): JSX.Element => {
  const azure = useWatch<
    AiSettingsFormValues,
    'providers.azure-openai.azureOpenaiSettings'
  >({ name: 'providers.azure-openai.azureOpenaiSettings' });
  return (
    <output
      data-testid="azure-probe"
      data-resource-name={azure?.resourceName ?? ''}
      data-base-url={azure?.baseURL ?? ''}
      data-api-version={azure?.apiVersion ?? ''}
      data-use-entra-id={String(azure?.useEntraId ?? false)}
    />
  );
};

const FormHarness = ({
  formValues,
  children,
}: {
  formValues: AiSettingsFormValues;
  children: ReactNode;
}): JSX.Element => {
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: formValues,
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  disabled = false,
  formValues = buildFormValues(),
}: {
  disabled?: boolean;
  formValues?: AiSettingsFormValues;
} = {}) =>
  render(
    <FormHarness formValues={formValues}>
      <AzureOpenaiSettings disabled={disabled} />
      <AzureSettingsProbe />
    </FormHarness>,
  );

describe('AzureOpenaiSettings', () => {
  it('renders unconditionally (no global provider gate) — the caller guarantees azure-only mounting', () => {
    // Act: the form no longer has a global `provider` field; the section must
    // still render its four fields.
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

  it('does not render the model/deployment-name field (it lives in the shared list editor)', () => {
    // Act
    renderComponent();

    // Assert: this section is connection-only.
    expect(
      screen.queryByLabelText('ai_settings.azure_model_deployment_label'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('ai_settings.model_label'),
    ).not.toBeInTheDocument();
  });

  it('reflects the seeded form values from providers.azure-openai.azureOpenaiSettings.*', () => {
    // Act
    renderComponent({
      formValues: buildFormValues({
        resourceName: 'seeded-resource',
        baseURL: 'https://seeded.example.com',
        apiVersion: '2024-10-01',
      }),
    });

    // Assert: each input shows the value seeded at the azure-openai slot's path.
    expect(
      screen.getByLabelText('ai_settings.azure_resource_name_label'),
    ).toHaveValue('seeded-resource');
    expect(
      screen.getByLabelText('ai_settings.azure_base_url_label'),
    ).toHaveValue('https://seeded.example.com');
    expect(
      screen.getByLabelText('ai_settings.azure_api_version_label'),
    ).toHaveValue('2024-10-01');
  });

  it('writes edits back to providers.azure-openai.azureOpenaiSettings.resourceName', async () => {
    // Arrange
    const user = userEvent.setup();
    renderComponent();
    expect(screen.getByTestId('azure-probe')).toHaveAttribute(
      'data-resource-name',
      '',
    );

    // Act: type into the resource-name input.
    await user.type(
      screen.getByLabelText('ai_settings.azure_resource_name_label'),
      'typed-resource',
    );

    // Assert: the form value at the azure-openai path is updated (not a stray
    // top-level `azureOpenaiSettings`).
    expect(screen.getByTestId('azure-probe')).toHaveAttribute(
      'data-resource-name',
      'typed-resource',
    );
  });

  it('shows the Entra ID note only when useEntraId is true, and toggling writes to the azure-openai slot', async () => {
    // Arrange: note hidden by default
    const user = userEvent.setup();
    renderComponent();
    expect(
      screen.queryByText('ai_settings.azure_entra_id_api_key_note'),
    ).not.toBeInTheDocument();

    // Act: toggle the Entra ID switch on
    await user.click(screen.getByRole('switch'));

    // Assert: note appears and the flag is written to the azure-openai slot.
    expect(
      screen.getByText('ai_settings.azure_entra_id_api_key_note'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('azure-probe')).toHaveAttribute(
      'data-use-entra-id',
      'true',
    );
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
