// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import { AI_PROVIDERS } from '../../interfaces/ai-provider';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import type { AiSettingsFormValues } from './ai-settings-form-values';
import { ProviderCommonSettings } from './ProviderCommonSettings';

const defaultFormValues: AiSettingsFormValues = {
  aiEnabled: true,
  provider: 'openai',
  apiKey: '',
  allowedModels: [
    { model: 'gpt-4o', providerOptionsText: '', isDefault: true },
  ],
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
  // Mirror the container's `onChange` validation mode so the providerOptions
  // JSON error surfaces as the field changes (matching production behavior).
  const methods = useForm<AiSettingsFormValues>({
    mode: 'onChange',
    defaultValues: { ...defaultFormValues, ...defaultValues },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const renderComponent = ({
  isApiKeySet = false,
  disabled = false,
  defaultValues,
}: {
  isApiKeySet?: boolean;
  disabled?: boolean;
  defaultValues?: Partial<AiSettingsFormValues>;
} = {}) =>
  render(
    <FormHarness defaultValues={defaultValues}>
      <ProviderCommonSettings isApiKeySet={isApiKeySet} disabled={disabled} />
    </FormHarness>,
  );

describe('ProviderCommonSettings', () => {
  describe('provider select', () => {
    it('offers only the AI_PROVIDERS values as options', () => {
      // Act
      renderComponent();

      // Assert: every supported provider is an option, and nothing else is.
      const options = screen
        .getAllByRole('option')
        .map((opt) => (opt as HTMLOptionElement).value)
        .filter((v) => v !== '');
      expect(options).toEqual([...AI_PROVIDERS]);
    });
  });

  // The model field now lives inside the single allowed-models list editor
  // hosted here for every provider; the list editor switches the row label by
  // the watched provider (generic model id vs. Azure deployment name).
  describe('allowed-models list', () => {
    it('hosts the list editor with the generic model label for non-Azure providers', () => {
      renderComponent({ defaultValues: { provider: 'openai' } });

      expect(
        screen.getByRole('button', { name: 'ai_settings.add_model' }),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText('ai_settings.model_label'),
      ).toBeInTheDocument();
    });

    it('labels the row as the Azure deployment name for Azure OpenAI', () => {
      renderComponent({ defaultValues: { provider: 'azure-openai' } });

      expect(
        screen.getByLabelText('ai_settings.azure_model_deployment_label'),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText('ai_settings.model_label'),
      ).not.toBeInTheDocument();
    });
  });

  describe('apiKey input', () => {
    it('is a password-masked input', () => {
      // Act
      renderComponent();

      // Assert
      const apiKeyInput = screen.getByLabelText('ai_settings.api_key_label');
      expect(apiKeyInput).toHaveAttribute('type', 'password');
    });
  });

  // The per-row providerOptions JSON validation is owned by `AllowedModelsField`
  // (see its spec). Here we only confirm the list editor is wired into this
  // component so a malformed value surfaces an inline error through it.
  describe('providerOptions JSON validation (delegated to the list editor)', () => {
    it('surfaces an inline validation message for invalid JSON in a model row', async () => {
      // Arrange
      renderComponent();
      const textarea = screen.getByLabelText(
        'ai_settings.provider_options_label',
      );

      // Act: enter malformed JSON (the leading `{` is escaped as `{{` for
      // userEvent's keyboard syntax; the field ends up containing `{ invalid json`).
      await userEvent.setup().type(textarea, '{{ invalid json');

      // Assert
      expect(
        await screen.findByText('ai_settings.provider_options_invalid_json'),
      ).toBeInTheDocument();
    });
  });

  describe('env-only mode', () => {
    it('disables every input so the locked fields cannot be focused', () => {
      // Act
      renderComponent({ disabled: true });

      // Assert: disabled (not readOnly) so the fields are removed from the tab
      // order and cannot receive focus. The model + providerOptions inputs are
      // rendered by the nested allowed-models list editor.
      expect(screen.getByRole('combobox')).toBeDisabled();
      expect(screen.getByLabelText('ai_settings.api_key_label')).toBeDisabled();
      expect(screen.getByLabelText('ai_settings.model_label')).toBeDisabled();
      expect(
        screen.getByLabelText('ai_settings.provider_options_label'),
      ).toBeDisabled();
    });
  });

  // SECURITY: ai:apiKey is shared across providers. Switching provider must warn
  // the admin (a stored key will be discarded) and clear any key typed for the
  // previous provider, so the old provider's secret is never submitted/reused.
  describe('apiKey provider-change handling (security)', () => {
    const changeProvider = async (value: string) => {
      await userEvent
        .setup()
        .selectOptions(screen.getByRole('combobox'), value);
    };

    it('warns that the saved key will be discarded when the provider changes and a key is stored', async () => {
      renderComponent({ isApiKeySet: true });
      expect(
        screen.queryByText('ai_settings.api_key_provider_change_warning'),
      ).not.toBeInTheDocument();

      await changeProvider('google');

      expect(
        screen.getByText('ai_settings.api_key_provider_change_warning'),
      ).toBeInTheDocument();
    });

    it('does not warn when no key is stored', async () => {
      renderComponent({ isApiKeySet: false });

      await changeProvider('google');

      expect(
        screen.queryByText('ai_settings.api_key_provider_change_warning'),
      ).not.toBeInTheDocument();
    });

    it('clears a key typed for the previous provider when the provider changes', async () => {
      renderComponent({ isApiKeySet: false });
      const apiKeyInput = screen.getByLabelText(
        'ai_settings.api_key_label',
      ) as HTMLInputElement;

      await userEvent.setup().type(apiKeyInput, 'sk-typed-for-openai');
      expect(apiKeyInput.value).toBe('sk-typed-for-openai');

      await changeProvider('google');

      // The typed key is dropped so it is never submitted for the new provider.
      expect(apiKeyInput.value).toBe('');
    });
  });

  describe('provider options help', () => {
    it('links to the AI SDK provider-options documentation', () => {
      // Act
      renderComponent();

      // Assert
      const link = screen.getByRole('link', {
        name: 'https://ai-sdk.dev/docs/foundations/provider-options',
      });
      expect(link).toHaveAttribute(
        'href',
        'https://ai-sdk.dev/docs/foundations/provider-options',
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });
});
