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
