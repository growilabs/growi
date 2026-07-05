// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

// Render i18n keys verbatim; assertions target the observable DOM contract
// (toggle checked/disabled, placeholder text, chip state, azure fields).
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import type { AiProvider } from '../../interfaces/ai-provider';
import type {
  AiSettingsFormValues,
  ProviderFormValue,
} from './ai-settings-form-values';
import { ProviderPanel } from './ProviderPanel';

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
  overrides?: Partial<Record<AiProvider, Partial<ProviderFormValue>>>,
): AiSettingsFormValues => {
  const base: Record<AiProvider, ProviderFormValue> = {
    openai: emptyProvider(),
    anthropic: emptyProvider(),
    google: emptyProvider(),
    'azure-openai': emptyProvider(),
  };
  const providers: Record<AiProvider, ProviderFormValue> = {
    openai: { ...base.openai, ...overrides?.openai },
    anthropic: { ...base.anthropic, ...overrides?.anthropic },
    google: { ...base.google, ...overrides?.google },
    'azure-openai': { ...base['azure-openai'], ...overrides?.['azure-openai'] },
  };
  return { aiEnabled: true, providers, allowedModels: [] };
};

/** Read-only probe mirroring a provider slot's `enabled` flag into the DOM. */
const EnabledProbe = ({ provider }: { provider: AiProvider }): JSX.Element => {
  const providers = useWatch<AiSettingsFormValues, 'providers'>({
    name: 'providers',
  });
  return (
    <output
      data-testid="enabled-probe"
      data-enabled={String(providers?.[provider]?.enabled ?? false)}
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

const MODELS_SENTINEL = 'models-slot-sentinel';

const renderComponent = ({
  provider = 'openai',
  isApiKeySet = false,
  useOnlyEnvVars = false,
  formValues,
  withChild = true,
}: {
  provider?: AiProvider;
  isApiKeySet?: boolean;
  useOnlyEnvVars?: boolean;
  formValues?: AiSettingsFormValues;
  withChild?: boolean;
} = {}) =>
  render(
    <FormHarness formValues={formValues ?? buildFormValues()}>
      <ProviderPanel
        provider={provider}
        isApiKeySet={isApiKeySet}
        useOnlyEnvVars={useOnlyEnvVars}
      >
        {withChild ? <input data-testid={MODELS_SENTINEL} /> : null}
      </ProviderPanel>
      <EnabledProbe provider={provider} />
    </FormHarness>,
  );

describe('ProviderPanel', () => {
  describe('enabled toggle (1.5)', () => {
    it('reflects the seeded enabled flag for the provider slot', () => {
      // Act
      renderComponent({
        provider: 'openai',
        formValues: buildFormValues({ openai: { enabled: true } }),
      });

      // Assert
      expect(screen.getByRole('switch')).toBeChecked();
    });

    it('writes the toggle change back to providers.<provider>.enabled', async () => {
      // Arrange
      const user = userEvent.setup();
      renderComponent({ provider: 'anthropic' });
      const toggle = screen.getByRole('switch');
      expect(toggle).not.toBeChecked();
      expect(screen.getByTestId('enabled-probe')).toHaveAttribute(
        'data-enabled',
        'false',
      );

      // Act
      await user.click(toggle);

      // Assert: the correct provider slot's flag flips.
      expect(toggle).toBeChecked();
      expect(screen.getByTestId('enabled-probe')).toHaveAttribute(
        'data-enabled',
        'true',
      );
    });
  });

  describe('API key input (1.8)', () => {
    it('shows the "(configured)" placeholder when a key is already stored, without exposing any value', () => {
      // Act
      renderComponent({ provider: 'openai', isApiKeySet: true });

      // Assert: placeholder signals "set" but the field never carries the key.
      const apiKeyInput = screen.getByLabelText('ai_settings.api_key_label');
      expect(apiKeyInput).toHaveAttribute(
        'placeholder',
        'ai_settings.api_key_set_placeholder',
      );
      expect(apiKeyInput).toHaveValue('');
    });

    it('shows no placeholder when no key is stored', () => {
      // Act
      renderComponent({ provider: 'openai', isApiKeySet: false });

      // Assert
      expect(
        screen.getByLabelText('ai_settings.api_key_label'),
      ).toHaveAttribute('placeholder', '');
    });
  });

  describe('key-status chip (1.8)', () => {
    it('shows the "set" chip when a key is stored', () => {
      // Act
      renderComponent({ isApiKeySet: true });

      // Assert
      expect(
        screen.getByText('ai_settings.api_key_set_chip'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('ai_settings.api_key_not_set_chip'),
      ).not.toBeInTheDocument();
    });

    it('shows the "not set" chip when no key is stored', () => {
      // Act
      renderComponent({ isApiKeySet: false });

      // Assert
      expect(
        screen.getByText('ai_settings.api_key_not_set_chip'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('ai_settings.api_key_set_chip'),
      ).not.toBeInTheDocument();
    });
  });

  describe('Azure connection settings (1.10)', () => {
    it('renders AzureOpenaiSettings only for the azure-openai panel', () => {
      // Act
      renderComponent({ provider: 'azure-openai' });

      // Assert: the azure connection section is present.
      expect(
        screen.getByLabelText('ai_settings.azure_resource_name_label'),
      ).toBeInTheDocument();
    });

    it('does not render AzureOpenaiSettings for a non-azure panel', () => {
      // Act
      renderComponent({ provider: 'openai' });

      // Assert
      expect(
        screen.queryByLabelText('ai_settings.azure_resource_name_label'),
      ).not.toBeInTheDocument();
    });
  });

  describe('misconfiguration warning', () => {
    it('shows the missing-api-key warning when enabled without a key', () => {
      // Act: enabled but no stored key and nothing typed.
      renderComponent({
        provider: 'openai',
        isApiKeySet: false,
        formValues: buildFormValues({ openai: { enabled: true } }),
      });

      // Assert: the warning surfaces the missing-key message.
      expect(
        screen.getByTestId('provider-misconfigured-warning'),
      ).toHaveTextContent('ai_settings.provider_warning_missing_api_key');
    });

    it('shows the missing-azure-endpoint warning for azure enabled without an endpoint', () => {
      // Act: azure enabled but neither resourceName nor baseURL set.
      renderComponent({
        provider: 'azure-openai',
        isApiKeySet: false,
        formValues: buildFormValues({ 'azure-openai': { enabled: true } }),
      });

      // Assert: endpoint is checked first, so the endpoint message wins.
      expect(
        screen.getByTestId('provider-misconfigured-warning'),
      ).toHaveTextContent(
        'ai_settings.provider_warning_missing_azure_endpoint',
      );
    });

    it('does not show the warning when the provider is available (enabled with a key)', () => {
      // Act
      renderComponent({
        provider: 'openai',
        isApiKeySet: true,
        formValues: buildFormValues({ openai: { enabled: true } }),
      });

      // Assert
      expect(
        screen.queryByTestId('provider-misconfigured-warning'),
      ).not.toBeInTheDocument();
    });

    it('does not show the warning when the provider is disabled', () => {
      // Act: toggle off — a disabled provider is admin intent, not a fault.
      renderComponent({
        provider: 'openai',
        isApiKeySet: false,
        formValues: buildFormValues({ openai: { enabled: false } }),
      });

      // Assert
      expect(
        screen.queryByTestId('provider-misconfigured-warning'),
      ).not.toBeInTheDocument();
    });
  });

  describe('models slot', () => {
    it('renders the passed children at the models insertion point', () => {
      // Act
      renderComponent({ provider: 'openai' });

      // Assert
      expect(screen.getByTestId(MODELS_SENTINEL)).toBeInTheDocument();
    });
  });

  describe('env-only mode (5.2 / 5.3)', () => {
    it('disables the connection settings (enabled toggle + apiKey + azure fields) but keeps the models slot editable', () => {
      // Act: azure panel so the azure fields are present to assert on.
      renderComponent({
        provider: 'azure-openai',
        isApiKeySet: true,
        useOnlyEnvVars: true,
      });

      // Assert: connection settings are disabled (not focusable) — 5.2. The
      // azure panel has two switches (enabled + Entra ID), so target the enabled
      // toggle by its label.
      expect(
        screen.getByLabelText('ai_settings.provider_enabled_label'),
      ).toBeDisabled();
      expect(screen.getByLabelText('ai_settings.api_key_label')).toBeDisabled();
      expect(
        screen.getByLabelText('ai_settings.azure_resource_name_label'),
      ).toBeDisabled();

      // Assert: the models slot child stays editable — model editing is not
      // locked by env-only (5.3). The panel must not wrap it in a disabled
      // fieldset.
      expect(screen.getByTestId(MODELS_SENTINEL)).toBeEnabled();
    });
  });
});
