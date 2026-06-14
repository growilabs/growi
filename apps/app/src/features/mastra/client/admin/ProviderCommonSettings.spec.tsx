// @vitest-environment happy-dom

import type { JSX, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  model: 'gpt-4o',
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

  describe('model field', () => {
    it('renders the generic model field for non-Azure providers', () => {
      renderComponent({ defaultValues: { provider: 'openai' } });

      expect(
        screen.getByLabelText('ai_settings.model_label'),
      ).toBeInTheDocument();
    });

    it('does not render the model field for Azure OpenAI (it lives in the Azure section)', () => {
      renderComponent({ defaultValues: { provider: 'azure-openai' } });

      expect(
        screen.queryByLabelText('ai_settings.model_label'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('ai_settings.azure_model_deployment_label'),
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

  describe('providerOptions JSON validation', () => {
    it('shows an inline validation message after entering invalid, non-empty JSON', async () => {
      // Arrange
      renderComponent();
      const textarea = screen.getByLabelText(
        'ai_settings.provider_options_label',
      );

      // Act: enter malformed JSON (onChange validation runs synchronously).
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '{ invalid json' } });
        await Promise.resolve();
      });

      // Assert: an inline error is surfaced for malformed JSON.
      expect(
        await screen.findByText('ai_settings.provider_options_invalid_json'),
      ).toBeInTheDocument();
    });

    it('does not show a validation message for valid JSON', async () => {
      // Arrange
      renderComponent();
      const textarea = screen.getByLabelText(
        'ai_settings.provider_options_label',
      );

      // Act
      await act(async () => {
        fireEvent.change(textarea, {
          target: { value: '{"temperature":0.7}' },
        });
        await Promise.resolve();
      });

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });

    it('does not show a validation message when empty', () => {
      // Arrange
      renderComponent({ defaultValues: { providerOptions: '' } });

      // Assert
      expect(
        screen.queryByText('ai_settings.provider_options_invalid_json'),
      ).not.toBeInTheDocument();
    });
  });

  describe('env-only mode', () => {
    it('disables every input so the locked fields cannot be focused', () => {
      // Act
      renderComponent({ disabled: true });

      // Assert: disabled (not readOnly) so the fields are removed from the tab
      // order and cannot receive focus.
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
      await act(async () => {
        fireEvent.change(screen.getByRole('combobox'), { target: { value } });
        await Promise.resolve();
      });
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

    it('hides the warning once a new key is entered, and re-shows it when cleared', async () => {
      renderComponent({ isApiKeySet: true });
      await changeProvider('google');
      expect(
        screen.getByText('ai_settings.api_key_provider_change_warning'),
      ).toBeInTheDocument();

      const apiKeyInput = screen.getByLabelText(
        'ai_settings.api_key_label',
      ) as HTMLInputElement;

      // Entering a new key means it will NOT be discarded -> warning hides.
      await act(async () => {
        fireEvent.change(apiKeyInput, { target: { value: 'new-google-key' } });
        await Promise.resolve();
      });
      expect(
        screen.queryByText('ai_settings.api_key_provider_change_warning'),
      ).not.toBeInTheDocument();

      // Clearing it again -> the stored key would be discarded -> warning returns.
      await act(async () => {
        fireEvent.change(apiKeyInput, { target: { value: '' } });
        await Promise.resolve();
      });
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

      await act(async () => {
        fireEvent.change(apiKeyInput, {
          target: { value: 'sk-typed-for-openai' },
        });
        await Promise.resolve();
      });
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
